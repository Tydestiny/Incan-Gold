import random
from collections import defaultdict

def setup_deck():
    """
    创建并返回一个标准的35张牌的牌堆。
    - 20张宝藏牌
    - 5种灾害，每种3张
    """
    deck = []
    
    # 添加20张宝藏牌
    deck.extend(['treasure'] * 20)
    
    # 添加15张灾害牌 (5种 x 3张)
    hazards = ['snake', 'boulder', 'fire', 'mummy', 'spider']
    for hazard in hazards:
        deck.extend([hazard] * 3)
        
    return deck

def run_single_simulation():
    """
    运行一次完整的翻牌模拟，直到游戏结束。
    返回游戏结束时翻开的牌的数量。
    """
    # 1. 准备一个全新的、洗好的牌堆
    deck = setup_deck()
    random.shuffle(deck)
    
    # 2. 初始化记录
    cards_flipped_count = 0
    hazards_seen = set() # 用一个集合来记录已经出现过的灾害类型
    
    # 3. 开始从牌堆顶翻牌
    for card in deck:
        cards_flipped_count += 1 # 无论翻出什么牌，计数器都+1
        
        # 4. 判断翻出的牌是否是灾害牌
        if card != 'treasure':
            # 5. 如果是灾害牌，检查之前是否见过
            if card in hazards_seen:
                # 如果这张灾害牌之前已经见过，说明出现了重复的灾害
                # 游戏结束！
                return cards_flipped_count
            else:
                # 如果是第一次见到这种灾害，就把它记录下来
                hazards_seen.add(card)
    
    return cards_flipped_count

# --- 主程序 (已更新) ---
if __name__ == "__main__":
    # 设置模拟的总次数
    num_simulations = 1_000_000 # 运行一百万次以获得一个稳定的结果
    
    # 使用一个字典来存储每种结果出现的次数
    # defaultdict(int) 会在键不存在时自动创建并赋值为0，非常方便
    results_distribution = defaultdict(int)
    
    # 运行指定次数的模拟
    for i in range(num_simulations):
        # 打印进度
        if (i + 1) % 100_000 == 0:
            print(f"正在进行模拟... {i + 1}/{num_simulations}")
            
        # 运行一次模拟并获取翻牌数
        num_cards = run_single_simulation()
        
        # 将对应结果的计数+1
        results_distribution[num_cards] += 1
        
    # --- 结果分析与输出 ---
    print("\n--- 模拟结果分析 ---")
    print(f"总模拟次数: {num_simulations:,}")
    
    # 1. 计算期望值 (和之前一样)
    total_cards_flipped = sum(k * v for k, v in results_distribution.items())
    expected_value = total_cards_flipped / num_simulations
    print(f"\n翻开卡牌数量的期望值 (平均值): {expected_value:.4f}")
    
    # 2. 打印每种结果的次数和概率分布
    print("\n--- 结果分布详情 ---")
    print("翻牌数\t\t出现次数\t\t概率")
    print("-" * 45)

    # 按翻牌数（字典的键）进行排序，以便清晰地展示
    for num_cards in sorted(results_distribution.keys()):
        count = results_distribution[num_cards]
        probability = (count / num_simulations) * 100 # 转换为百分比
        # 使用格式化字符串来对齐输出
        print(f"{num_cards:<15}\t{count:<15,}\t{probability:>7.4f}%")
        
    # 3. 计算累计概率
    print("\n--- 累计概率分析 (风险评估) ---")
    print("翻到X张牌或更少时游戏结束的概率")
    print("-" * 45)
    cumulative_probability = 0
    for num_cards in sorted(results_distribution.keys()):
        count = results_distribution[num_cards]
        probability = (count / num_simulations) * 100
        cumulative_probability += probability
        print(f"<= {num_cards:<14}\t{cumulative_probability:>7.4f}%")