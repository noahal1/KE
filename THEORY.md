# KE 肌肉理论数值算法 — 理论文档(v1)

> 状态:**草案,待确认后实现**。
> 检索服务当时不可用,文中文献条目凭既有知识整理,关键出处标注了置信度;
> 实现前建议对 ⚠ 标记的条目做一次在线核对。

本文定义四层纯函数算法,不依赖 UI 与 SQL,输入为已查询的数据行:

1. **强度体系**(Intensity)— e1RM、RPE/RIR、%1RM
2. **有效刺激**(Stimulus)— 有效次数、分数容量归因到每块肌肉
3. **疲劳与恢复**(Fatigue)— 每肌群周组数 vs 容量地标、ACWR、单调性/应激
4. **进阶推荐**(Progression)— 双重渐进、目标配重、deload 触发

---

## 0. 数据基础与已知差距

现有字段(来自 `set_logs` / `exercises` / `sessions`):

| 字段 | 用途 |
|---|---|
| `weight_kg`, `reps` | 一切强度与容量计算的基数 |
| `rpe`(可空) | RIR → 有效次数;**缺失率是最大风险,见 §2.4** |
| `is_warmup`, `is_pr` | 热身组一律剔除;PR 仅作展示,不进算法 |
| `primary_muscles` / `secondary_muscles` | 分数容量归因 |
| `started_at` / `finished_at` | 训练时长(密度、Foster 单调性) |
| `equipment`, `pattern` | 动作分类、进阶增量档位 |

已知差距(实现时处理):

- **RPE 缺失**:老数据/未记录组无 RPE。策略见 §2.4,任何刺激类指标必须同时报告覆盖率。
- **自重动作**:`weight_kg` 对自重动作语义不明(0 还是含体重?)。
  **已解决(v1.1,见 §5.3)**:记录口径统一为「外挂重量」(`weight_kg` 存 0/外挂),
  另存 `load_kg` 有效负荷列;算法层吨位一律走 `effectiveLoadKg()` 单点切换。
  e1RM 仍只对外挂重量输出(自重递归不回填)。
- **单位**:库内统一 kg(`lb` 仅展示层换算),算法只在 kg 域运算。
- **热身组**:`is_warmup = 1` 在 SQL 层即过滤,算法层不再假设。

---

## 1. 强度体系(Intensity)

### 1.1 RPE ↔ RIR

换算是定义式,不是经验式:

```
RIR = 10 − RPE        (RIR = Reps In Reserve,力竭前剩余次数)
```

依据 Zourdos et al. 2016 的 RPE 量表(RPE 10 = 0 RIR,9 = 1 RIR,…)。
应用中凡用户记录 RPE,一律先转 RIR 参与计算。

### 1.2 e1RM 估算(单组)

两条经典线性经验式,取**双式均值**作为输出,双式差值 >8% 时标记低置信:

```
Epley  : 1RM = w × (1 + r/30)
Brzycki: 1RM = w × 36 / (37 − r)
```

- **有效域**:r ≤ 10 时两式与实测 1RM 偏差通常 <5%;r ∈ (10, 12] 偏差渐增;
  r > 12 **不用于 e1RM**(次数太多次数-负荷关系非线性,误差放大)。
- **RPE 修正**(RTS/Tuchscherer 思路):若该组记录了 RPE,
  用「到力竭的总次数」替代 r:

  ```
  1RM = w × (1 + (r + RIR) / 30)
  ```

  这在未做力竭组时更准(常规训练组多为 RIR 1–4)。
- **选组规则**:同一动作同一日多组时,取 (w × r) 乘积最大且 r ≤ 10 的工作组;
  无合格组则当日无 e1RM。

### 1.3 %1RM 与处方逆推

给定目标次数 r_target 与目标 RIR,目标配重:

```
kEpley   = 1 + (r_target + RIR) / 30
kBrzycki = 36 / (37 − (r_target + RIR))
w_target = e1RM / mean(kEpley, kBrzycki)
%1RM     = 100 × w_target / e1RM
```

两式对 w 均为线性,故双式均值的逆推**精确互逆**:
`prescribeLoad(e1rm(组), r, rir)` 会还原原始重量(测试已验证)。

例:e1RM 100kg,目标 8 次 @ RIR 2 → rf=10,kE=4/3,kB=4/3 → 75kg。
配重按杠铃/哑铃最小增量向下取整(见 §4.3)。

### 1.4 输出置信标记

每个 e1RM 输出附带 `confidence: "high" | "medium" | "low"`:

| 条件 | 置信 |
|---|---|
| r + RIR ≤ 8(有 RPE) | high |
| r ≤ 10 无 RPE,或 r + RIR ∈ (8,10] | medium |
| r + RIR ∈ (10,12],或双式差 >8% | low |
| r + RIR > 12 或自重动作 | 不输出(null) |

---

## 2. 有效刺激(Stimulus)

### 2.1 有效次数模型

核心假设(「有效次数理论 / effective reps」):一组中,只有接近力竭的次数
(约 RIR ≤ 5)对肌肥大刺激有显著贡献;更远端的次数运动单位募集不足。

> 依据:近五年证据综述(Refalo 2023;Jacinto 2021/2022;Robinson 2024 剂量-反应
> meta 分析)总体支持「接近力竭与刺激正相关,但 RIR ≤ 4~5 区间内差异不大,
> 过远(RIR > 5)刺激下降」。⚠ 该阈值是**近似分界而非硬证据**,5 是工程取整。

**组内近似推导**:设该组结束时剩余 RIR_end,按「每完成一次 RIR 递减 1」的
近似,组内做过的各次发生时剩余 RIR 为 RIR_end+1, …, RIR_end+r;其中发生时
RIR ≤ 5 的次数即有效次数 → `clamp(6 − RIR_end, 0, r)`。

实现定义(整数、可复现):

```
effective_reps(set) = clamp(6 − RIR_end, 0, r)
```

即统计 RIR 值 ∈ {0,…,5} 的次数。例:10 次 @ RIR 2 结束 → 4 次有效;
10 次 @ RIR 0 → 6 次有效。

> 已知失真:真实疲劳非线性(前几次几乎无消耗),本式是**保守线性近似**,
> 统一偏差方向(略微低估中段),可接受;文档化,不做复杂曲线直到有证据。

**有效组数**用于周容量对标:一组是否算「有效组」,按组末 RIR:

| RIR_end | 有效组权重 |
|---|---|
| 0–1 | 1.0 |
| 2–3 | 0.85 |
| 4–5 | 0.6 |
| >5 | 0.3 |

> 该分段是工程设定(依据同上,方向正确、点位主观);系数集中在
> `landmarks.ts` 单点配置,便于后续按证据/个人反馈调参。

### 2.2 分数容量归因(fractional sets)

把每组的容量/组数分摊到每块肌肉,替代现在 StatsPage 的「按主肌群全归因」:

```
对每组 s:
  primary 每块 × 1.0
  secondary 每块 × 0.5
per-muscle 周容量 = Σ 所有组
```

- 0.5 为常用中值;文献中次肌群系数常见 0.25–0.5。
  ⚠ 没有公认精确值,是**序数正确、基数近似**的模型:主 > 次 > 0 的排序可信,
  具体系数影响的是绝对刻度而非相对结论。
- **归一化**:每组的总贡献恒为 1 — 多肌群动作按系数比例**分摊**该组
  (如 1 主 + 2 次 → 主 1/2、各次 1/4),而非每块肌肉各记全额。
  这保证总容量在动作间可比,归因保守(不会因协同肌多而虚增)。
- 容量口径 v1 用**吨位(tonnage = w×r)**与**组数**双口径分开输出:
  组数口径对标 §3 容量地标(未乘有效组权重),吨位口径用于趋势图;
  另输出 RIR 加权的有效组归因作为刺激视角。

### 2.3 刺激量(stimulus volume,合并口径)

更精细的单指标:对每个「肌肉×组」,刺激量 = 有效组权重 × Σ effective_reps?
—— v1 不做复合指标,保持三个正交输出,避免无法解释的混合量纲:

1. `effective_reps`(组级)
2. `fractional_sets`(肌肉×周)
3. `fractional_tonnage`(肌肉×周)

### 2.4 RPE 缺失策略

- 数据库内 RPE 覆盖率 < 阈值(默认 60%)时,刺激类指标整体标记
  `coverage: "low"`,UI 提示「记录 RPE 可提升精度」。
- 单组缺 RPE 时的插补(可配置,默认 a):
  - a) **假设 RIR_end = 3**(典型增肌处方端点,中性假设)→ 有效权重 0.85
  - b) 平权 0.5(不猜端点,直接给中等权重)
  - c) 剔除(仅当用户明确要求「只看已记录数据」)
- 报告端永远同时输出 `n_total / n_with_rpe`,绝不静默混用。

---

## 3. 疲劳与恢复(Fatigue)

### 3.1 每肌群容量地标(MEV / MAV / MRV)

模型:Israetel / RP 体系 — 每肌群每周有效组数存在三个区间:

- **MEV**(最小有效量):低于它,该肌群大概率不增长
- **MAV**(最大适应量):增益最优区间
- **MRV**(最大可恢复量):超过它,疲劳吃掉增益

**重要立场**:地标数值是**先验(Bayesian prior)而非真理** — RP 自己反复强调
个体差异大,要靠酸痛、表现、食欲等反馈个体化。因此实现为可配置表,
默认值只做冷启动。

表内数值:⚠ 文献条目为 RP《Scientific Principles of Hypertrophy Training》
中级训练者常用默认,不同版本出入较大,**实现前需对照原书核对**;
下表为工程默认(区间制,单位:每周有效组,含间接刺激):

| 肌群 | MEV | MAV | MRV |
|---|---|---|---|
| 胸 | 6–8 | 12–20 | 22 |
| 背(背阔+中背) | 8–12 | 14–24 | 26 |
| 股四头肌 | 4–8 | 8–16 | 20 |
| 腘绳肌 | 4–6 | 8–16 | 20 |
| 臀 | 0–4 | 4–12 | 16 |
| 三角肌(三束合并*) | 6–10 | 10–20 | 26 |
| 肱二头肌 | 6–8 | 12–20 | 26 |
| 肱三头肌 | 4–6 | 10–14 | 24 |
| 前臂 | 2–4 | 4–8 | 12 |
| 斜方肌 | 0–4 | 6–12 | 20 |
| 小腿 | 6–8 | 10–16 | 20 |
| 腹肌 | 4–6 | 8–16 | 24 |

\* 应用肌群 key 不分束(`shoulders` 单 key),取三束典型混合(推类间接 +
中/后束孤立)的包络;引入分束 key 前以此为基准。

对标输出(`muscle_weekly`):每肌群每周 fractional_sets 落入
「< MEV / MEV–MAV / MAV–MRV / > MRV」四档,UI 用四档色阶,不做「报警」语态
(见 3.3 对 ACWR 的批判,同一立场:描述,不当判官)。

### 3.2 ACWR(急慢性负荷比)

```
急性负荷 = 最近 7 天吨位总和
慢性负荷 = 最近 28 天吨位总和 / 4
ACWR = 急性 / 慢性          (慢性为 0 时不输出)
```

- 常用分档(Gabbett 2016):0.8–1.3 常规;>1.5 为「尖峰」。
- 实现 v1 用滚动窗口而非 EWMA(EWMA 更平滑但解释成本高,后续可加)。
- **必附批判说明**:Impellizzeri et al. 2020 等对 ACWR 的效度有系统批评
  (两个噪声量的比值、断点伪影、忽略个体基线)。因此定位为
  **描述性趋势指标**,不作为 injury risk 预测器输出;
  尖峰时给「本周量明显高于近月基线」的中性提示。

### 3.3 Foster 单调性 / 应激(可选,v1 做进 `landmarks` 之外的最小实现)

```
周会话负荷 {L_i}(Foster sRPE 口径:负荷 = Σ reps × RPE;缺 RPE 按 RPE 10 计,保守上界;吨位口径另行输出)
单调性 monotony = mean(L) / sd(L)      (sd=0 或 <3 会话时输出 null)
应激 strain = ΣL × monotony
```

- 单调性 > 2.0 常被引用为过度训练风险区(Foster 1998)。
- 仅在有 ≥3 次会话且时长/RPE 可用的周输出,低样本不给。
- 依赖 `finished_at` 非空;v1 若发现时长数据质量差则降级为纯周量趋势。

### 3.4 Deload 触发(与 §4.2 联动)

满足任一,建议 deload 周(容量 ×~0.5,强度 −10%):

1. 连续 2 周**同一肌群** fractional_sets > MRV(逐周求交,只认持续超限的肌群);
2. ACWR ≥ 1.5;
3. 用户手动(总是允许)。

---

## 4. 进阶推荐(Progression)

### 4.1 双重渐进(double progression)

对每个「计划动作」逐次评估(对比该动作上一非热身记录):

```
若 该次所有工作组 reps ≥ rep_max 且 min(RIR) ≤ 2:
    推荐 w_next = w + increment(见 4.3),次数回到 rep_min
若 该次存在组 reps < rep_min:
    推荐 w_next = w × 0.9(向下取整增量),次数区间不变
否则:维持重量,推荐次数 = 上一档达成情况向 rep_max 推进
```

- 无 RPE 时跳过 `min(RIR) ≤ 2` 条件(只看次数达标)。
- `rep_min/rep_max` 来自 `plan_exercises`;自由训练(无计划)动作只给
  e1RM 与 %1RM 处方,不给渐进指令。

### 4.2 %1RM 目标配重

§1.3 的逆推式,配 e1RM 池化规则:

- e1RM 池 = 该动作最近 4 次有 e1RM 的会话的**最大值**(疲劳日不压低处方);
- 池空则回退用「最近一次 w×r 最大组」现场估算。

### 4.3 增量档位(可配置)

| 器械类别 | 增量 |
|---|---|
| 杠铃(下肢动作 pattern ∈ squat/hinge)| 5 kg |
| 杠铃(其他) | 2.5 kg |
| 哑铃/固定器械 | 2.5 kg(按实际配片取整) |
| 自重 | 次数 +1/组,不加重 |

### 4.4 趋势(最小版,已接入 StatsPage ✓)

- e1RM 趋势:每动作按会话时间散点(每会话取当日最佳估算)+ 最近
  `TREND.WINDOW`(4)点 OLS 斜率(kg/周,展示层换算;不足
  `TREND.MIN_POINTS`(3)点不输出;纯平直线斜率为 0 而非 null)。
- 不做「预测 x 周后 1RM」的推算(外推不可靠),只描述斜率。
- 候选动作 = 有效组(1–12 次、非零重量)覆盖 ≥3 个会话的动作,
  取前 30 个供选择。

---

## 5. 身体数据层(Body,v1.1)

身体数据不是孤立记录,而是贯穿全库的第二数据轴:体重给自重动作定价、
给吨位口径补全、给力量表现提供归一化分母。

### 5.1 数据与录入

- `body_logs` 表:`logged_at` / `weight_kg` / `body_fat_pct`(可空) / `note`。
- `settings` 表 profile 键:`profile.sex` / `profile.age` / `profile.height_cm` /
  `profile.goal_weight_kg`(目标体重,用于趋势进度读数)。
- 录入入口:设置页(主入口,带 BMI 与最近记录)、日历选中日面板(补记历史日期,
  记录戳到当日 12:00 本地时,避免 DST 边界)。

### 5.2 体重趋势

EWMA 平滑,α = 0.5(`BODY.EWMA_ALPHA`):抑制单日水分波动,不需每日打卡。
输出当前平滑值、斜率(kg/周,首尾平滑值差 ÷ 天数 ×7)、累计变化、最新体脂。
目标进度:`(当前 − 起点) / (目标 − 起点)`,钳制 0–100%,显示距目标剩余量。

### 5.3 自重动作负荷定价(吨位口径统一)

自重动作的容量问题是「重量 × 次数」在 `weight_kg = 0` 时无意义。定价模型:

```
load_kg = 体重 × f(pattern) + 外挂重量
f: 下肢(squat/hinge/single-leg) = 0.9
   上肢推拉(其余 pattern)    = 0.65
   核心/支撑(core/rotation)  = 0.5
```

- 系数是生物力学文献的保守中点(引体向上实际约 95%+ 含前臂,卧推类俯卧撑约 64%,
  平板支撑做功位移小取 50%);⚠ 序数可信、基数近似,与 §2.2 分数系数同一立场。
- **记录口径**:`weight_kg` 永远存外挂重量(自重填 0);`load_kg` 在记录时由 UI
  按当时体重折算写入——历史记录不随体重追溯变化,数据是即时快照。
- **单点切换**:算法层所有吨位消费方(分数归因 §2.2、ACWR/单调性吨位 §3、
  SQL 容量汇总)统一走 `effectiveLoadKg()` / `COALESCE(load_kg, weight_kg)`。
  无体重时的降级路径:`load_kg = NULL` → 容量退回 `weight_kg`(老数据不受影响)。
- **e1RM 不变**:仍只对外挂重量输出(§0 自重不输出 e1RM),因为次数-力竭关系
  定义在外加负荷上;自重递归回填是 v2 议题。
- **UI 预览**:训练页自重动作输入重量时实时显示「≈ 有效负荷」,设置页未填体重
  时显示提示文案。

### 5.4 力量体重比(strength-to-weight)

```
比值 = 动作最高负重(weight_kg 口径,纯外挂) ÷ 当前体重
```

- 用途:减脂期「体重降、比值升」说明力量未掉;增肌期比值稳定即进步。
- 定位与 §3.2 ACWR 相同:描述性指标,不当判官;不引入 Wilks/DOTS 等评分体系
  (系数表复杂且更新频繁,如有需求后续作为独立模块)。

### 5.5 实现计划

### 5.1 模块布局(纯函数,无 React / 无 SQL)

```
src/lib/metrics/
  landmarks.ts    // 所有系数/地标表/增量档位/身体常量(BODY),单点配置
  intensity.ts    // rpeToRir, e1rm, loadFor, pct1rm (+confidence)
  stimulus.ts     // effectiveReps, effectiveSetWeight, fractionalAttribution
  fatigue.ts      // weeklyMuscleSets(对标地标), acwr, monotony/strain, deloadCheck
  progression.ts  // doubleProgression, prescribeLoad, deloadSuggestion
  body.ts         // bmi, weightTrend(EWMA), bodyweightLoadKg  (§5)
  index.ts        // barrel + 公共类型(SetRow, SessionRow …)
```

约定:输入是从现有查询得到的行(`weight_kg/reps/rpe/…`),
输出带 `confidence` / `coverage` 元数据;任何未知数据**显式降级,不静默假设**。

### 5.2 测试方案(沿用项目冒烟测试文化,不引入新依赖)

新增 `scripts/metrics-smoke-test.mjs`(node assert,风格对齐
`sql-smoke-test.cjs`;Node ≥ 22.6 原生类型剥离直接跑 TS 源,无需构建,
模块相对导入须带显式 `.ts` 扩展):

- 公式锚点:Epley/Brzycki 手算例、处方逆推往返一致性
  (`loadFor(e1rm(w,r)) ≈ w`)。
- 性质测试:e1RM 对 w 单调;effective_reps 对 RIR 单调(同 r);
  分数归因 sum(各肌群) = 1.0。
- 边界:r > 12 → null;慢性负荷 = 0 → ACWR null;RPE 全缺 → coverage low。
- 搭配现有 `npx tsc --noEmit` 全量类型检查。

### 5.3 分期

1. **P1**(已完成 ✓):`landmarks + intensity + stimulus`(§1、§2)— 纯函数,
   `scripts/metrics-smoke-test.mjs`(28 项)全绿,未接 UI。
2. **P2**(已完成 ✓):`fatigue`(§3)— ISO 周分桶(输入驱动,
   `started_at` 毫秒时间戳)、周容量对标四档、滚动 7d/28d ACWR、
   Foster 单调性/应激、deload 触发(连续超限逐周求交)。
   `scripts/fatigue-report.mjs` 用合成 5 周数据出文本报告;测试增至 37 项。
3. **P3**(已完成 ✓):`progression`(§4)纯函数 + 测试(双重渐进、
   增量取整、e1RM 池化处方、趋势斜率);进行中训练页接入「下一组建议」行
   (SetForm 首组预填推荐值,UI 仅作建议不强制);StatsPage 已接入疲劳监控
   (热力格/ACWR/单调性/减载卡片)、分数容量分布(次肌群上榜,
   §2.2 归因)与 e1RM 趋势图(SVG 折线 + 回归虚线,§4.4)。
4. **P4**(已完成 ✓):身体数据层 `body.ts`(§5)— BMI、EWMA 体重趋势、
   自重负荷定价;`body_logs` 表 + `set_logs.load_kg` 列;吨位口径统一
   `effectiveLoadKg()`;UI:设置页身体数据区块(资料/记体重/BMI/目标体重)、
   统计页体重趋势 + 目标进度 + 力量体重比、日历体重标记与补记、
   训练页自重折算实时预览。

---

## 6. 参考文献(⚠ 均需实现前抽查核对)

- Epley B. (1995). 1RM 预测式。*JSCR* — Epley 公式出处。
- Brzycki M. (1993). *JOPERD* — Brzycki 公式出处。
- Zourdos M. et al. (2016). RPE 量表与抗阻训练。*JSCR* — RPE/RIR 量表。
- Tuchscherer M. / RTS(Rise Training System)— RPE 修正 e1RM 的实践体系。
- Israetel M. et al. *Scientific Principles of Hypertrophy Training*(RP)—
  容量地标(MEV/MAV/MRV)体系。
- Refalo M. et al. (2023). 接近力竭与肌肥大,系统综述。*Sports Med*。
- Jacinto J. et al. (2021, 2022). RIR 5 vs 力竭长期实验。
- Robinson Z. et al. (2024). 训练量-反应剂量 meta 分析。
- Gabbett T. (2016). 训练-损伤研究中的 ACWR。*Sports Med*。
- Impellizzeri F. et al. (2020). 对 ACWR 的方法学批判。*Sports Med*。
- Foster C. (1998). 单调性与应激。*JSCR*。

置信度注记:公式类(§1)高;有效次数阈值与分数系数(§2)方向性证据强、
点位为工程设定;容量地标表(§3.1)为流派经验默认,个体差异大。
