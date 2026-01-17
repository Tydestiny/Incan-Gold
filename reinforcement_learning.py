import gymnasium as gym
from gymnasium import spaces
import numpy as np
import random
from stable_baselines3 import PPO
import torch as th
import os
import re # 用于提取文件名中的数字

class IncanGoldSelfPlayEnv(gym.Env):
    # ... (IncanGoldSelfPlayEnv 类定义保持不变，省略以节省空间) ...
    def __init__(self, opponent_model=None):
        super(IncanGoldSelfPlayEnv, self).__init__()
        self.action_space = spaces.Discrete(2)
        self.observation_space = spaces.Box(low=0, high=200, shape=(11,), dtype=np.float32)
        self.opponent_model = opponent_model
        self.TREASURE_VALUES = [1, 2, 3, 4, 5, 5, 7, 7, 9, 11, 11, 13, 14, 15, 17]
        self.HAZARD_TYPES = ['snake', 'spider', 'mummy', 'fire', 'rocks']
        self.ARTIFACT_VALUES = [5, 7, 8, 10, 12]

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.round = 1
        self.total_players = 4 
        self.active_ids = [0, 1, 2, 3] 
        self.players_hand_gems = {0:0, 1:0, 2:0, 3:0}
        self.path_cards_remains = [] 
        self.path_artifacts = 0    
        self.revealed_hazards = {k: 0 for k in self.HAZARD_TYPES}
        self.current_game_artifacts = self.ARTIFACT_VALUES[:]
        random.shuffle(self.current_game_artifacts)
        self._init_deck()
        return self._get_obs(0), {}

    def _init_deck(self):
        self.deck = []
        for val in self.TREASURE_VALUES:
            self.deck.append({'type': 'treasure', 'val': val})
        for h in self.HAZARD_TYPES:
            for _ in range(3):
                self.deck.append({'type': 'hazard', 'val': h})
        if self.round <= 5:
            val = self.current_game_artifacts[self.round-1]
            self.deck.append({'type': 'artifact', 'val': val})
        random.shuffle(self.deck)

    def _get_obs(self, player_id):
        total_remains = sum(self.path_cards_remains)
        obs = [
            self.round,
            self.players_hand_gems[player_id],
            total_remains,
            self.path_artifacts,
            self.revealed_hazards['snake'],
            self.revealed_hazards['spider'],
            self.revealed_hazards['mummy'],
            self.revealed_hazards['fire'],
            self.revealed_hazards['rocks'],
            len(self.deck),
            len(self.active_ids)
        ]
        return np.array(obs, dtype=np.float32)

    def _get_opponent_action(self, player_id):
        if self.opponent_model is None:
            risk = sum(self.revealed_hazards.values())
            money = self.players_hand_gems[player_id]
            if risk >= 2 or money > 8:
                return 1 if random.random() < 0.8 else 0
            return 0
        obs = self._get_obs(player_id)
        action, _ = self.opponent_model.predict(obs, deterministic=False) 
        return int(action)

    def step(self, action):
        leavers = []
        if action == 1: leavers.append(0)
        for pid in [1, 2, 3]:
            if pid in self.active_ids:
                opp_act = self._get_opponent_action(pid)
                if opp_act == 1: leavers.append(pid)
        reward = 0
        terminated = False
        if len(leavers) > 0:
            gems_per_leaver = 0
            for i in range(len(self.path_cards_remains)):
                gems = self.path_cards_remains[i]
                if gems > 0:
                    share = int(gems / len(leavers))
                    gems_per_leaver += share
                    self.path_cards_remains[i] = gems % len(leavers)
            artifact_bonus = 0
            if len(leavers) == 1 and self.path_artifacts > 0:
                artifact_bonus = self.path_artifacts * self.current_game_artifacts[self.round-1]
                self.path_artifacts = 0 
            for pid in leavers:
                total_gain = self.players_hand_gems[pid] + gems_per_leaver
                if len(leavers) == 1: total_gain += artifact_bonus
                if pid == 0:
                    reward = total_gain
                    terminated = True 
                if pid in self.active_ids:
                    self.active_ids.remove(pid)
        if not terminated:
            if len(self.active_ids) == 0: terminated = True
            elif len(self.deck) == 0:
                terminated = True
                reward = self.players_hand_gems[0]
            else:
                card = self.deck.pop()
                if card['type'] == 'treasure':
                    val = card['val']
                    share = int(val / len(self.active_ids))
                    remainder = val % len(self.active_ids)
                    for pid in self.active_ids: self.players_hand_gems[pid] += share
                    self.path_cards_remains.append(remainder)
                elif card['type'] == 'artifact': self.path_artifacts += 1
                elif card['type'] == 'hazard':
                    h = card['val']
                    self.revealed_hazards[h] += 1
                    if self.revealed_hazards[h] >= 2:
                        if 0 in self.active_ids:
                            reward = 0
                            terminated = True
                        self.active_ids = []
        return self._get_obs(0), reward, terminated, False, {}

# --- 迭代训练主程序 ---

def train_self_play():
    print("=== 印加宝藏自我对抗训练系统 ===")
    start_input = input("请输入起始模型编号 (直接回车从 Gen-0 开始, 或输入数字如 '5'): ").strip()
    
    current_model_path = ""
    start_gen = 0

    if start_input == "" or start_input == "0":
        # 1. 初始阶段：训练 Gen-0 (对抗傻瓜规则)
        print("\n🚀 正在训练 Generation-0 (vs Random Bots)...")
        env = IncanGoldSelfPlayEnv(opponent_model=None)
        model = PPO("MlpPolicy", env, verbose=1)
        model.learn(total_timesteps=100000)
        model.save("gen_0")
        current_model_path = "gen_0"
        start_gen = 1
        print("✅ Gen-0 完成")
    else:
        # 加载用户指定的模型
        start_gen = int(start_input)
        current_model_path = f"gen_{start_gen}"
        if not os.path.exists(current_model_path + ".zip"):
            print(f"❌ 错误: 找不到文件 {current_model_path}.zip")
            return
        print(f"✅ 已加载起始模型: {current_model_path}")
        start_gen += 1 # 下一个训练的代数

    target_input = input("想要训练到的目标总代数 (例如 '20'): ").strip()
    target_gen = int(target_input) if target_input != "" else start_gen + 5

    # 2. 进化阶段
    for i in range(start_gen, target_gen + 1):
        prev_model_path = f"gen_{i-1}"
        print(f"\n🚀 正在训练 Generation-{i} (基准/对手: {prev_model_path})...")
        
        # 加载上一代模型作为对手
        opponent_model = PPO.load(prev_model_path)
        
        # 创建新环境
        env = IncanGoldSelfPlayEnv(opponent_model=opponent_model)
        
        # 创建新模型 (继承上一代参数起点)
        new_model = PPO.load(prev_model_path, env=env)
        
        # 训练 (设置每代步数为 300,000)
        new_model.learn(total_timesteps=300000)
        
        # 保存
        current_model_path = f"gen_{i}"
        new_model.save(current_model_path)
        print(f"✅ Generation-{i} 训练完成并保存.")

    # 3. 导出最强的一代
    print(f"\n💾 正在导出最终模型 {current_model_path} 为 ONNX...")
    final_model = PPO.load(current_model_path)
    
    class OnnxablePolicy(th.nn.Module):
        def __init__(self, extractor, action_net, value_net):
            super().__init__()
            self.extractor = extractor
            self.action_net = action_net
            self.value_net = value_net
        def forward(self, observation):
            action_hidden, value_hidden = self.extractor(observation)
            return self.action_net(action_hidden)

    onnx_policy = OnnxablePolicy(
        final_model.policy.mlp_extractor,
        final_model.policy.action_net,
        final_model.policy.value_net
    )
    dummy_input = th.randn(1, 11)
    th.onnx.export(
        onnx_policy, dummy_input, "incan_gold_selfplay_final.onnx",
        opset_version=15, input_names=["input"], output_names=["output"]
    )
    print("🎉 完成！最终模型已同步为: incan_gold_selfplay_final.onnx")

if __name__ == "__main__":
    train_self_play()