# 附录A：完整可运行脚本 `brain_sim_full.py`

> 本脚本整合 **记忆网络、思维链、情绪模块、相互调用**，可直接运行 `python brain_sim_full.py` 查看端到端演示。

```python
# brain_sim_full.py
from collections import defaultdict, deque
import random


# ============================================================
# 一、基础结构：节点、边、记忆网络
# ============================================================
class Node:
    def __init__(self, nid, content, modality="concept", emotion=(0.0, 0.0)):
        self.nid = nid
        self.content = content
        self.modality = modality
        self.emotion = emotion          # (valence, arousal)
        self.activation = 0.0


class Edge:
    def __init__(self, src, dst, rel, weight=1.0):
        self.src = src
        self.dst = dst
        self.rel = rel
        self.weight = weight


class MemoryNetwork:
    """分布式记忆网络 + 海马索引"""

    def __init__(self):
        self.nodes = {}
        self.edges = defaultdict(list)
        self.hippocampus = {}

    def add_node(self, node):
        self.nodes[node.nid] = node

    def add_edge(self, src, dst, rel, weight=1.0, bidirectional=True):
        self.edges[src].append(Edge(src, dst, rel, weight))
        if bidirectional:
            self.edges[dst].append(Edge(dst, src, rel, weight))

    def bind_episode(self, name, nids):
        """海马索引：把分散片段绑定成情景"""
        self.hippocampus[name] = list(nids)

    def spread(self, seeds, steps=3, decay=0.65):
        """并行激活扩散"""
        act = defaultdict(float)
        for s in seeds:
            act[s] = 1.0
        frontier = deque(seeds)
        for _ in range(steps):
            nxt = deque()
            for nid in frontier:
                for e in self.edges[nid]:
                    gain = act[nid] * e.weight * decay
                    if gain > act[e.dst] + 1e-6:
                        act[e.dst] = gain
                        nxt.append(e.dst)
            frontier = nxt
        return act

    def recall(self, cue, episode, steps=4, decay=0.7):
        """模式完成：一个线索激活整条记忆链"""
        act = self.spread([cue], steps=steps, decay=decay)
        bound = set(self.hippocampus.get(episode, []))
        return sorted(
            ((n, round(a, 3)) for n, a in act.items() if n in bound),
            key=lambda x: -x[1]
        )

    def replay(self, episode, cycles=3, lr=1.1):
        """序列重放：巩固相邻连接"""
        seq = self.hippocampus[episode]
        for _ in range(cycles):
            for a, b in zip(seq, seq[1:]):
                for e in self.edges[a]:
                    if e.dst == b:
                        e.weight *= lr

    def reconsolidate(self, episode, new_order):
        """再巩固：提取时重构记忆顺序"""
        self.hippocampus[episode] = list(new_order)

    def forget(self, episode, drop_ratio=0.2, decay=0.5):
        """遗忘：随机削弱部分连接"""
        seq = self.hippocampus[episode]
        for a, b in zip(seq, seq[1:]):
            if random.random() < drop_ratio:
                for e in self.edges[a]:
                    if e.dst == b:
                        e.weight *= decay

    def node_emotions(self):
        return {nid: n.emotion for nid, n in self.nodes.items()}


# ============================================================
# 二、思维链：思维图、工作记忆、推理器
# ============================================================
class ThoughtGraph:
    """命题/子目标之间的推理关系图"""

    def __init__(self):
        self.adj = defaultdict(list)

    def add(self, a, b, rel, w=1.0):
        self.adj[a].append((b, rel, w))

    def neighbors(self, nid):
        return self.adj.get(nid, [])


class WorkingMemory:
    """工作记忆：容量瓶颈 + 串行轨迹"""

    def __init__(self, capacity=4):
        self.base_capacity = capacity
        self.capacity = capacity
        self.slots = []
        self.trace = []

    def attend(self, scored):
        ranked = sorted(scored, key=lambda x: -x[1])
        self.slots = [n for n, _ in ranked[:self.capacity]]
        return self.slots

    def record(self, prev, rel, cur, note=""):
        self.trace.append({"from": prev, "rel": rel, "to": cur, "note": note})


class Reasoner:
    """目标导向的串行推理器（系统1/2简化）"""

    def __init__(self, graph, wm, goal=None):
        self.g = graph
        self.wm = wm
        self.goal = goal

    def score(self, cand):
        nxt, rel, w = cand
        s = w * (2 if rel in ("causal", "temporal", "implies") else 1)
        if self.goal and nxt == self.goal:
            s += 10
        return

    def metacog_check(self, path):
        if len(path) != len(set(path)):
            return False, "检测到循环"
        if len(path) > 8:
            return False, "路径过长"
        return True, "ok"

    def think(self, start, goal, max_steps=8):
        self.goal = goal
        path, cur = [start], start
        for _ in range(max_steps):
            if cur == goal:
                break
            cands = self.g.neighbors(cur)
            if not cands:
                self.wm.record(cur, "dead_end", None, "无可用后继")
                break
            scored = [(nxt, self.score((nxt, rel, w))) for nxt, rel, w in cands]
            chosen = self.wm.attend(scored)[0]
            rel = next(r for n, r, w in cands if n == chosen)
            self.wm.record(cur, rel, chosen)
            path.append(chosen)
            cur = chosen
            ok, msg = self.metacog_check(path)
            if not ok:
                self.wm.record(cur, "metacog_stop", None, msg)
                break
        return path


# ============================================================
# 三、情绪模块：效价 × 唤醒
# ============================================================
class EmotionState:
    def __init__(self, valence=0.0, arousal=0.0):
        self.valence = max(-1.0, min(1.0, valence))
        self.arousal = max(0.0, min(1.0, arousal))

    def __repr__(self):
        return f"Emotion(v={self.valence:+.2f}, a={self.arousal:.2f})"

    def decay(self, rate=0.15):
        self.valence *= (1 - rate)
        self.arousal *= (1 - rate)

    def copy(self):
        return EmotionState(self.valence, self.arousal)


class EmotionModule:
    """情绪评估、调制、调节"""

    def appraise(self, event_emotion, goal_progress, current, sensitivity=0.6):
        ev, ea = event_emotion
        goal_v = goal_progress * 0.5
        goal_a = abs(goal_progress) * 0.4
        new_v = current.valence + sensitivity * (ev + goal_v - current.valence)
        new_a = current.arousal + sensitivity * (ea + goal_a - current.arousal)
        return EmotionState(new_v, new_a)

    def retrieval_bias(self, act, current, node_emotions, bias_strength=0.5):
        biased = {}
        for nid, a in act.items():
            ev, ea = node_emotions.get(nid, (0.0, 0.0))
            congruence = 1.0 - abs(current.valence - ev) / 2.0
            arousal_gain = 1.0 + current.arousal * 0.8
            salience = 1.0 + ea * 0.5
            biased[nid] = a * (1 + bias_strength * congruence) * arousal_gain * salience
        return biased

    def reasoning_bias(self, scored_cands, current, node_emotions):
        mode = self.mode_switch(current)
        biased = []
        for nid, s, rel in scored_cands:
            ev, ea = node_emotions.get(nid, (0.0, 0.0))
            bonus = 0.0
            if current.valence < -0.2 and current.arousal > 0.4:
                bonus += max(0, -ev) * current.arousal * 1.2
            if current.valence > 0.2:
                bonus += max(0, ev) * current.valence * 0.8
            if mode == "analytic" and rel in ("causal", "implies", "temporal"):
                bonus += 0.4
            if mode == "heuristic" and rel in ("semantic", "assoc"):
                bonus += 0.3
            biased.append((nid, s + bonus, rel))
        return biased

    def mode_switch(self, current):
        if current.valence > 0.25:
            return "heuristic"
        if current.valence < -0.2:
            return "analytic"
        return "neutral"

    def wm_capacity_penalty(self, current, base_capacity=4):
        load = current.arousal * max(0, -current.valence)
        return max(2, base_capacity - int(round(load * 2)))

    def consolidation_gain(self, current, base_lr=1.1):
        return base_lr * (1.0 + current.arousal * 0.5)

    def regulate(self, current, strategy="reappraise"):
        if strategy == "reappraise":
            return EmotionState(current.valence * 0.7, current.arousal * 0.5)
        if strategy == "suppress":
            return EmotionState(current.valence * 0.8, current.arousal * 0.6)
        if strategy == "distract":
            return EmotionState(current.valence * 0.9, current.arousal * 0.4)
        return current.copy()


# ============================================================
# 四、整合代理：记忆 + 思维 + 情绪
# ============================================================
class CognitiveAgent:
    def __init__(self, memory, capacity=4):
        self.mem = memory
        self.wm = WorkingMemory(capacity)
        self.graph = ThoughtGraph()
        for src, es in memory.edges.items():
            for e in es:
                self.graph.add(src, e.dst, e.rel, e.weight)
        self.emotion = EmotionState()
        self.emotion_module = EmotionModule()
        self.new_memories = []

    def retrieve(self, cue, topk=3):
        act = self.mem.spread([cue], steps=3, decay=0.65)
        biased = self.emotion_module.retrieval_bias(
            act, self.emotion, self.mem.node_emotions()
        )
        return sorted(biased.items(), key=lambda x: -x[1])[:topk]

    def think_with_emotion(self, start, goal,
                           event_emotions=None,
                           goal_progress_map=None,
                           max_steps=8,
                           regulate_after=None):
        event_emotions = event_emotions or {}
        goal_progress_map = goal_progress_map or {}
        regulate_after = regulate_after or {}
        path, cur = [start], start
        self.wm.trace = []

        for _ in range(max_steps):
            if cur == goal:
                break

            ev = event_emotions.get(cur, (0.0, 0.0))
            gp = goal_progress_map.get(cur, 0.0)
            self.emotion = self.emotion_module.appraise(ev, gp, self.emotion)

            self.wm.capacity = self.emotion_module.wm_capacity_penalty(
                self.emotion, self.wm.base_capacity
            )

            retrieved = self.retrieve(cur, topk=self.wm.capacity)
            rd = dict(retrieved)

            cands = self.graph.neighbors(cur)
            scored = []
            for nxt, rel, w in cands:
                s = w * (2 if rel in ("causal", "temporal", "implies") else 1)
                s += rd.get(nxt, 0)
                if nxt == goal:
                    s += 10
                scored.append((nxt, s, rel))

            if not scored:
                self.wm.record(cur, "dead_end", None, "无可用后继")
                break

            biased = self.emotion_module.reasoning_bias(
                scored, self.emotion, self.mem.node_emotions()
            )
            biased.sort(key=lambda x: -x[1])
            chosen, _, rel = biased[0]

            self.wm.record(
                cur, rel, chosen,
                f"emo={self.emotion} "
                f"mode={self.emotion_module.mode_switch(self.emotion)} "
                f"wm_cap={self.wm.capacity} retrieved={retrieved}"
            )
            path.append(chosen)
            cur = chosen

            if cur in regulate_after:
                self.emotion = self.emotion_module.regulate(
                    self.emotion, regulate_after[cur]
                )
                self.wm.record(cur, "regulate", None, f"→ {self.emotion}")

            self.emotion.decay(rate=0.08)

        self.learn_from_thought(path)
        return path

    def learn_from_thought(self, path, name=None):
        name = name or f"thought_{len(self.new_memories)}"
        self.mem.bind_episode(name, path)
        lr = self.emotion_module.consolidation_gain(self.emotion)
        self.mem.replay(name, cycles=2, lr=lr)
        for a, b in zip(path, path[1:]):
            self.graph.add(a, b, "inferred", 0.8)
            self.mem.add_edge(a, b, "inferred", 0.8, bidirectional=False)
        self.new_memories.append(name)
        return name


# ============================================================
# 五、演示
# ============================================================
def build_memory_with_emotion():
    m = MemoryNetwork()
    nodes = [
        ("起床", "起床", (0.0, 0.2)),
        ("下雨", "下雨", (-0.3, 0.4)),
        ("忘带伞", "忘带伞", (-0.5, 0.5)),
        ("迟到", "迟到", (-0.6, 0.7)),
        ("被批评", "被批评", (-0.8, 0.9)),
        ("带伞", "带伞", (0.3, 0.3)),
        ("不迟到", "不迟到", (0.5, 0.4)),
        ("不被批评", "不被批评", (0.7, 0.5)),
    ]
    for nid, c, emo in nodes:
        m.add_node(Node(nid, c, emotion=emo))

    edges = [
        ("起床", "下雨", "temporal", 1.0),
        ("下雨", "忘带伞", "causal", 0.9),
        ("忘带伞", "迟到", "causal", 0.8),
        ("迟到", "被批评", "causal", 0.9),
        ("下雨", "带伞", "causal", 0.95),
        ("带伞", "不迟到", "causal", 0.9),
        ("不迟到", "不被批评", "causal", 0.9),
    ]
    for a, b, r, w in edges:
        m.add_edge(a, b, r, w)

    m.bind_episode("bad_morning", ["起床", "下雨", "忘带伞", "迟到", "被批评"])
    return m


def demo_memory():
    print("=" * 60)
    print("第一部分：记忆链")
    print("=" * 60)
    m = build_memory_with_emotion()
    print("线索=下雨 →", m.recall("下雨", "bad_morning"))
    print("线索=起床 →", m.recall("起床", "bad_morning"))

    before = [e.weight for e in m.edges["起床"] if e.dst == "下雨"][0]
    m.replay("bad_morning", cycles=2)
    after = [e.weight for e in m.edges["起床"] if e.dst == "下雨"][0]
    print(f"重放前 起床→下雨 权重 = {before:.3f}")
    print(f"重放后 起床→下雨 权重 = {after:.3f}")

    m.reconsolidate("bad_morning", ["起床", "下雨", "迟到", "忘带伞", "被批评"])
    print("再巩固后情景 =", m.hippocampus["bad_morning"])


def demo_thought():
    print("\n" + "=" * 60)
    print("第二部分：思维链")
    print("=" * 60)
    g = ThoughtGraph()
    for a, b, r, w in [
        ("起床", "下雨", "temporal", 1.0),
        ("下雨", "忘带伞", "causal", 0.9),
        ("忘带伞", "迟到", "causal", 0.8),
        ("迟到", "被批评", "causal", 0.9),
        ("下雨", "带伞", "causal", 0.95),
        ("带伞", "不迟到", "causal", 0.9),
        ("不迟到", "不被批评", "causal", 0.9),
    ]:
        g.add(a, b, r, w)

    wm = WorkingMemory(capacity=3)
    r = Reasoner(g, wm)
    path = r.think("起床", "不被批评")
    print("思维链路径 =", path)
    print("串行轨迹：")
    for step in wm.trace:
        print("  ", step)


def demo_emotion():
    print("\n" + "=" * 60)
    print("第三部分：情绪模块 + 记忆/思维相互调用")
    print("=" * 60)

    m = build_memory_with_emotion()
    agent = CognitiveAgent(m, capacity=4)

    event_emotions = {
        "下雨": (-0.3, 0.4),
        "忘带伞": (-0.5, 0.5),
        "迟到": (-0.6, 0.7),
        "被批评": (-0.8, 0.9),
        "带伞": (0.3, 0.3),
        "不迟到": (0.5, 0.4),
        "不被批评": (0.7, 0.5),
    }
    goal_progress_map = {
        "下雨": -0.1,
        "忘带伞": -0.5,
        "迟到": -0.7,
        "被批评": -0.9,
        "带伞": 0.5,
        "不迟到": 0.7,
        "不被批评": 0.9,
    }

    path = agent.think_with_emotion(
        start="起床",
        goal="不被批评",
        event_emotions=event_emotions,
        goal_progress_map=goal_progress_map,
        regulate_after={"被批评": "reappraise"}
    )

    print("整合路径 =", path)
    print("逐步轨迹：")
    for step in agent.wm.trace:
        print("  ", step)

    print("新记忆 =", agent.new_memories)
    print("新情景 =", m.hippocampus[agent.new_memories[0]])

    print("\n情绪一致性提取对比：")
    agent2 = CognitiveAgent(build_memory_with_emotion())
    agent2.emotion = EmotionState(valence=0.6, arousal=0.4)
    print("正情绪下 线索=下雨 →", agent2.retrieve("下雨", topk=5))
    agent2.emotion = EmotionState(valence=-0.6, arousal=0.7)
    print("负情绪下 线索=下雨 →", agent2.retrieve("下雨", topk=5))


def demo_all():
    demo_memory()
    demo_thought()
    demo_emotion()


if __name__ == "__main__":
    demo_all()
```
