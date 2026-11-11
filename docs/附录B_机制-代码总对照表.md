# 附录B：机制—代码总对照表

> 对应 `brain_sim_full.py` 中的类、方法与认知机制。

## B.1 记忆机制

| 人脑机制 | 对应代码 | 说明 |
|---|---|---|
| 分布式多模态记忆 | `MemoryNetwork.nodes` + `edges` | 节点表示片段，边表示关系 |
| 多种关系边 | `Edge.rel` | causal / temporal / semantic / spatial / emotional / procedural / inferred |
| 海马索引绑定 | `bind_episode()` | 把分散片段绑定成情景 |
| 并行激活扩散 | `spread()` | 从种子节点沿边传播激活 |
| 模式完成 | `recall()` | 一个线索激活整条记忆链 |
| 序列重放巩固 | `replay()` | 增强情景中相邻节点的连接权重 |
| 再巩固 | `reconsolidate()` | 提取后重构记忆顺序 |
| 遗忘 | `forget()` | 随机削弱部分连接 |
| 情绪标记记忆 | `Node.emotion` + `node_emotions()` | 每个节点带效价/唤醒标记 |

## B.2 思维链机制

| 人脑机制 | 对应代码 | 说明 |
|---|---|---|
| 推理关系网络 | `ThoughtGraph` | 命题/子目标之间的推理图 |
| 工作记忆容量瓶颈 | `WorkingMemory.capacity` | 默认约 4 个组块 |
| 注意选择 | `WorkingMemory.attend()` | 只保留激活最高的候选 |
| 串行思维链 | `WorkingMemory.trace` | 记录逐步推理轨迹 |
| 系统1/2 加权 | `Reasoner.score()` | 因果/时序/蕴含边加权，目标启发 |
| 目标导向推理 | `Reasoner.think()` | 从起点逐步推进到目标 |
| 元认知检查 | `Reasoner.metacog_check()` | 检测循环、路径过长 |

## B.3 思维链与记忆链相互调用

| 机制 | 对应代码 | 说明 |
|---|---|---|
| 记忆→思维检索 | `CognitiveAgent.retrieve()` | 当前节点作线索激活记忆 |
| 记忆激活为推理加权 | `rd.get(nxt, 0)` | 检索结果加入候选评分 |
| 检索—推理—验证循环 | `think_with_emotion()` | 每步检索、推理、记录 |
| 思维→记忆写回 | `learn_from_thought()` | 推理路径写入新情景 |
| 新关系固化 | `add_edge(..., "inferred")` | 推理产生的新边写入记忆与思维图 |
| 情绪增强巩固 | `consolidation_gain()` → `replay(lr=...)` | 高唤醒提高重放学习率 |

## B.4 情绪/感情模块

| 人脑机制 | 对应代码 | 说明 |
|---|---|---|
| 效价—唤醒二维情绪 | `EmotionState(valence, arousal)` | 情绪状态表示 |
| 目标进展评估 | `EmotionModule.appraise()` | 事件情绪 + 目标进展 → 新情绪 |
| 情绪一致性提取 | `retrieval_bias()` | 当前情绪偏向同效价记忆 |
| 情绪显著性增益 | `arousal_gain` / `salience` | 高唤醒整体激活增强 |
| 威胁偏向 | `reasoning_bias()` 负效价分支 | 焦虑/愤怒时负性候选加权 |
| 奖赏偏向 | `reasoning_bias()` 正效价分支 | 积极情绪时正性候选加权 |
| 加工模式切换 | `mode_switch()` | 积极→启发式；消极→分析 |
| 工作记忆占用 | `wm_capacity_penalty()` | 高唤醒负效价降低有效容量 |
| 情绪调节—重评 | `regulate("reappraise")` | 降低唤醒与负效价 |
| 情绪调节—抑制 | `regulate("suppress")` | 压低情绪强度 |
| 情绪调节—转移 | `regulate("distract")` | 快速降低唤醒 |
| 情绪自然衰减 | `EmotionState.decay()` | 随时间回落基线 |
| 预期情绪/价值 | `goal_progress_map` + 候选加分 | 目标情绪引导选择 |

## B.5 端到端回路

| 回路环节 | 代码入口 | 输出 |
|---|---|---|
| 线索/事件输入 | `think_with_emotion(start, goal, ...)` | 起始节点 |
| 情绪评估 | `appraise()` | 当前 `EmotionState` |
| 记忆检索 | `retrieve()` | 情绪偏向后的激活候选 |
| 思维选择 | `reasoning_bias()` + 排序 | 下一步节点 |
| 串行记录 | `WorkingMemory.record()` | 思维链轨迹 |
| 情绪调节 | `regulate()` | 调节后的情绪状态 |
| 写回与巩固 | `learn_from_thought()` | 新情景 + 新边 + 重放增强 |

---

