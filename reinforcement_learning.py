import random
import numpy as np
from collections import defaultdict

# --- 1. 环境 (The Game) ---
class IncanGoldEnv:
    def __init__(self):
        self.treasures = [3, 4, 5, 7, 9, 11, 13, 15, 17] # 简化宝藏牌为9种，总数20张左右
        self.hazards_setup = {'snake': 3, 'boulder': 3, 'fire': 3, 'mummy': 3, 'spider': 3}
        self.reset()

    def reset(self):
        """开始新的一轮（进入一个新神庙），重置所有状态"""
        # 创建牌堆
        self.deck = []
        self.deck.extend(self.treasures * 2 + [5,7]) # 凑齐20张宝藏
        for hazard, count in self.hazards_setup.items():
            self.deck.extend([hazard] * count)
        random.shuffle(self.deck)
        
        # 游戏状态
        self.cards_flipped = 0
        self.gems_in_pocket = 0
        self.hazards_on_path = []
        self.gems_on_path = 0
        self.done = False
        
        return self._get_state()

    def _get_state(self):
        """返回当前的状态元组"""
        # 状态: (已翻牌数, 已见灾害种类数, 口袋中宝石数)
        return (self.cards_flipped, len(set(self.hazards_on_path)), self.gems_in_pocket)

    def step(self, action):
        """代理执行一个动作 (0:留下, 1:逃跑)"""
        # --- 动作1: 逃跑 ---
        if action == 1:
            self.done = True
            # 奖励 = 口袋里的宝石 + 路上平分的宝石
            # 为了简化单人模式，我们假设路上宝石也归他
            reward = self.gems_in_pocket + self.gems_on_path
            return self._get_state(), reward, self.done

        # --- 动作0: 留下 ---
        # 翻开下一张牌
        if not self.deck:
            self.done = True # 牌翻完了，安全离开
            reward = self.gems_in_pocket + self.gems_on_path
            return self._get_state(), reward, self.done
            
        card = self.deck.pop(0)
        self.cards_flipped += 1

        if isinstance(card, int): # 是宝藏牌
            self.gems_in_pocket += card # 在单人模式下，所有宝石都归他
        else: # 是灾害牌
            if card in self.hazards_on_path:
                # 翻车了！
                self.done = True
                reward = -self.gems_in_pocket # 惩罚 = 丢失的宝石
                return self._get_state(), reward, self.done
            else:
                self.hazards_on_path.append(card)
        
        # 如果留下且安全，没有即时奖励
        reward = 0
        return self._get_state(), reward, self.done

# --- 2. 代理 (The AI Player) ---
class QLearningAgent:
    def __init__(self, actions, alpha=0.1, gamma=0.99, epsilon=1.0, epsilon_decay=0.99995, epsilon_min=0.01):
        self.actions = actions
        self.alpha = alpha       # 学习率
        self.gamma = gamma       # 折扣因子 (对未来奖励的重视程度)
        self.epsilon = epsilon   # 探索率
        self.epsilon_decay = epsilon_decay # 探索率衰减
        self.epsilon_min = epsilon_min     # 最小探索率
        self.q_table = defaultdict(lambda: np.zeros(len(actions))) # 使用defaultdict来自动处理新状态

    def choose_action(self, state):
        """根据当前状态和epsilon-greedy策略选择一个动作"""
        if random.random() < self.epsilon:
            return random.choice(self.actions) # 探索：随机选择
        else:
            return np.argmax(self.q_table[state]) # 利用：选择Q值最高的动作

    def learn(self, state, action, reward, next_state, done):
        """根据游戏反馈，更新Q-Table"""
        old_value = self.q_table[state][action]
        
        # 如果游戏结束，未来奖励为0
        next_max = np.max(self.q_table[next_state]) if not done else 0
        
        # Q-Learning核心公式
        new_value = old_value + self.alpha * (reward + self.gamma * next_max - old_value)
        self.q_table[state][action] = new_value
        
        # 探索率衰减
        if self.epsilon > self.epsilon_min:
            self.epsilon *= self.epsilon_decay

# --- 3. 训练循环 ---
if __name__ == "__main__":
    env = IncanGoldEnv()
    agent = QLearningAgent(actions=list(range(2))) # 动作空间 [0, 1]
    
    num_episodes = 50000
    total_rewards = []

    print("--- 开始训练 ---")
    for episode in range(num_episodes):
        state = env.reset()
        done = False
        episode_reward = 0
        
        while not done:
            action = agent.choose_action(state)
            next_state, reward, done = env.step(action)
            agent.learn(state, action, reward, next_state, done)
            state = next_state
            
            # 如果是最后一轮且成功，记录奖励
            if done and reward > 0:
                episode_reward = reward
        
        total_rewards.append(episode_reward)

        if (episode + 1) % 5000 == 0:
            avg_reward = np.mean(total_rewards[-1000:])
            print(f"回合: {episode + 1}/{num_episodes}, 平均奖励: {avg_reward:.2f}, 当前探索率ε: {agent.epsilon:.4f}")

    print("\n--- 训练完成 ---")
    
    # --- 4. 结果分析：查看代理学到的策略 ---
    print("\n--- 代理学到的部分决策策略 (Q-Table) ---")
    print("状态 (翻牌, 见灾害, 袋中宝) \t\t Q(留下) \t\t Q(逃跑) \t\t 决策")
    print("-" * 80)
    
    # 筛选并排序Q-table，只看有意义的状态
    sorted_states = sorted(agent.q_table.keys(), key=lambda x: (x[1], x[0], x[2]))
    
    for state in sorted_states:
        # 只打印一些有代表性的状态，避免刷屏
        if state[2] % 5 == 0 and state[2] > 0: # 只看宝石数为5的倍数的状态
            q_values = agent.q_table[state]
            action = "留下" if np.argmax(q_values) == 0 else "逃跑"
            print(f"{str(state):<30} \t {q_values[0]:.2f} \t\t {q_values[1]:.2f} \t\t {action}")