import { appId, firebaseConfig, initialAuthToken } from './config.js';


import { 
    initializeApp 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    signInAnonymously, 
    signInWithCustomToken, 
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup,
    signOut 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    setDoc, 
    onSnapshot, 
    getDoc, 
    setLogLevel 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

setLogLevel('error');


let db;
let auth;
let userId = 'loading';
let gameRef; 
let isListenerInitialized = false; 
let previousPlayersState = null; 
let isRestoringModal = false;

// 【NEW: 鎖定變數】防止按鈕點擊後，自動恢復機制再次觸發彈窗
let isProcessingAction = false; 

let gameState = null;
const totalSquares = 128;
const MOVE_DELAY = 200;

const DEFAULT_INITIAL_MONEY = 15000; 

const PLAYER_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b'];
const PLAYER_NAMES = ['紅玩家', '藍玩家', '綠玩家', '黃玩家'];

// NEW: 隱藏功能點擊間隔
const CLICK_THRESHOLD = 300; // milliseconds
let clickCount = 0;
let lastClickTime = 0;
const TAKEOVER_TIMEOUT_MS = 60000; // 60 秒非活躍時間才能接管

// NEW: 骰子圖片路徑映射
const DICE_IMAGES = {
    1: 'images/dice1.png',
    2: 'images/dice2.png',
    3: 'images/dice3.png',
    4: 'images/dice4.png',
    5: 'images/dice5.png',
    6: 'images/dice6.png',
};

// --- 2. 遊戲資料定義 ---

const DEFAULT_INTEREST_RATE = 0.01; 
const DEFAULT_VOLATILITY = 50; 

// ** NEW: 房產開發配置 **
const HOUSE_CONFIG = {
    // 房屋建設成本 (佔地產價格的比例)
    COST_MULTIPLIER: 0.5, 
    // 房屋數量的租金倍率 (0: 基礎租金, 1: 1 房, 2: 2 房, 3: 3 房, 4: 大樓)
    RENT_MULTIPLIERS: [1, 3, 5, 7, 10], 
    MAX_HOUSES: 4, // 0 房 + 4 級開發 = 5 個狀態
    MORTGAGE_MULTIPLIER: 0.5, // 抵押金比例
    MORTGAGE_SELL_TAX: 0.1, // 解除抵押的稅率
};
// ** END NEW **

const STOCKS_INITIAL_CONFIG = [
    { name: "Victorian Rail", symbol: "VRA", price: 500, sellPrice: 400, volatility: 30 },
    { name: "Coffee Futures", symbol: "CFE", price: 750, sellPrice: 600, volatility: 50 },
    { name: "Tram Network", symbol: "TNM", price: 300, sellPrice: 250, volatility: 20 },
];

const COLOR_MAP = {
    'bg-green-600': '#059669', 'bg-yellow-400': '#facc15', 'bg-gray-400': '#9ca3af', 'bg-red-600': '#dc2626', 
    'bg-purple-600': '#9333ea', 'bg-yellow-200': '#fef08a', 'bg-orange-400': '#fb923c', 'bg-red-400': '#f87171',
    'bg-green-500': '#22c55e', 'bg-indigo-300': '#a5b4fc', 'bg-sky-300': '#7dd3fc', 'bg-teal-300': '#5eead4', 
    'bg-pink-300': '#f9a8d4', 'bg-gray-100': '#f3f4f6', 
    'bg-red-900': '#7f1d1d', // 所得稅
    'bg-pink-900': '#831843' // 奢侈品稅
};

const CHANCE_CARDS = [
    { type: 'money', amount: 800, text: '機會: 您的建築貸款通過審核。獲得 $800。' },
    { type: 'money', amount: -400, text: '機會: 市議會要求清理環境。支付 $400。' },
    { type: 'goto_jail', text: '機會: 您的汽車發生小事故，被裁定交通違規。前往監獄 (Jail)。' },
    { type: 'trap_money', amount: -1000, text: '機會: **陷害卡** - 選擇一位玩家，他/她必須支付 $1000 的高額罰款。' }, // NEW TRAP
    { type: 'move_relative', amount: -3, text: '機會: 忘記帶鑰匙。後退 3 格。' },
    { type: 'money', amount: -100, text: '機會: 咖啡因中毒，需支付醫療費。支付 $100。' },
    { type: 'move', target: 0, text: '機會: 競選成功。前往起點 (GO)，獲得 $2000。' },
    { type: 'money', amount: 600, text: '機會: 贏得拼字大賽。獲得 $600。' },
    { type: 'money', amount: -200, text: '機會: 購買昂貴的設計師服裝。支付 $200。' },
    { type: 'move_relative', amount: 4, text: '機會: 快速通行證。前進 4 格。' }, 
];

const FATE_CARDS = [
    { type: 'money', amount: -50, text: '命運: 捐款給流浪動物之家。支付 $50。' },
    { type: 'move_relative', amount: 5, text: '命運: 抄近路。前進 5 格。' },
    { type: 'trap_jail', text: '命運: **陷害卡** - 選擇一位玩家，他/她因詐欺罪名被送往監獄 (Jail)。' }, // NEW TRAP
    { type: 'money', amount: -1000, text: '命運: 遭遇經濟詐騙。損失 $1000。' },
    { type: 'goto_jail', text: '命運: 被懷疑參與內線交易。前往監獄 (Jail)。' },
    { type: 'money', amount: 750, text: '命運: 找到一筆被遺忘的現金。獲得 $750。' },
    { type: 'money', amount: -250, text: '命運: 繳納豪華遊艇停泊費。支付 $250。' },
    { type: 'money', amount: 300, text: '命運: 您的銀行存款利息到帳。獲得 $300。' },
    { type: 'move', target: 127, text: '命運: 被邀請參加頂級峰會。直接前往終點。獲得 $5000。', reward: 5000 },
    { type: 'move_relative', amount: -5, text: '命運: 迷路。後退 5 格。' },
];


const MELBOURNE_SUBURBS = [
    "Toorak", "Brighton", "South Yarra", "Kew", "Malvern", "Armadale", "Hawthorn", "Camberwell", "Balwyn", "Doncaster",
    "Box Hill", "Glen Waverley", "Mount Waverley", "Clayton", "Oakleigh", "Bundoora", "Preston", "Reservoir", "Brunswick", "Fitzroy",
    "Carlton", "Collingwood", "Richmond", "St Kilda", "Williamstown", "Footscray", "Sunshine", "Altona", "Werribee", "Tarneit",
    "Pakenham", "Cranbourne", "Berwick", "Narre Warren", "Dandenong", "Frankston", "Mornington", "Geelong", "Bendigo", "Ballarat",
    "Port Melbourne", "Docklands", "Southbank", "Melbourne CBD", "Northcote", "Thornbury", "Coburg", "Pascoe Vale", "Essendon", "Moonee Ponds",
    "Ascot Vale", "Flemington", "Kensington", "Newport", "Seddon", "Yarraville", "Spotswood", "Fairfield", "Alphington", "Ivanhoe",
    "Heidelberg", "Greensborough", "Diamond Creek", "Eltham", "Templestowe", "Ringwood", "Croydon", "Lilydale", "Belgrave", "Dandenongs",
    "Beaconsfield", "Officer", "Clyde", "Kilsyth", "Ferntree Gully", "Rowville", "Scoresby", "Mulgrave", "Notting Hill", "Burwood",
    "Ashburton", "Glen Iris", "Surrey Hills", "Mont Albert", "Deepdene", "Canterbury", "Middle Park", "Albert Park", "Elwood", "Caulfield",
    "Murrumbeena", "Carnegie", "Bentleigh", "Moorabbin", "Cheltenham", "Sandringham", "Black Rock", "Beaumaris", "Mordialloc", "Aspendale"
];

const BOARD = [];

// --- 5.1 修正後的棋盤生成邏輯 (固定間隔 + 44 個特殊格) ---

// 核心固定角格 (移除 FREE_PARKING 和 GOTO_JAIL)
const fixedCornerSquares = {
    0: { name: '起點 (GO)', type: 'START', color: 'bg-green-600', action: 2000 },
    32: { name: '監獄 (JAIL)', type: 'JAIL', color: 'bg-yellow-400' }, // 監獄格 (只保留一個)
    64: { name: '所得稅 (10%)', type: 'INCOME_TAX', color: 'bg-red-900', action: 0.10 }, // 新增稅務格
    96: { name: '奢侈品稅 ($1000)', type: 'LUXURY_TAX', color: 'bg-pink-900', action: 1000 }, // 新增稅務格
    127: { name: '終點', type: 'FINISH', color: 'bg-purple-600', action: 5000 }
};

// 總共 128 格。固定角格 5 個。特殊格總數目標 44 個。
// 動態特殊格需要 44 - 5 = 39 個。
const numDynamicSpecial = 39;
const numProperties = totalSquares - Object.keys(fixedCornerSquares).length - numDynamicSpecial; // 128 - 5 - 39 = 84 個地產

// 39 個動態特殊類型分佈 (總數 39)
const specialCountsV4 = {
    BANK: 9,
    CHANCE: 10, // 機會卡
    FATE: 10,   // 命運卡
    CASINO: 10
};

// 1. 準備動態特殊類型列表 (總數 39)
const dynamicTypesToAssign = [];
for (const type in specialCountsV4) {
    for (let i = 0; i < specialCountsV4[type]; i++) {
        dynamicTypesToAssign.push(type);
    }
}

// Fisher-Yates Shuffle
for (let i = dynamicTypesToAssign.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [dynamicTypesToAssign[i], dynamicTypesToAssign[j]] = [dynamicTypesToAssign[j], dynamicTypesToAssign[i]];
}

// 2. 確定動態特殊格的位置
const dynamicSpecialIndices = [];
for (let i = 0; i < totalSquares; i++) {
    if (!fixedCornerSquares[i]) {
        dynamicSpecialIndices.push(i);
    }
}

// 隨機選取 39 個位置作為動態特殊格
const shuffledDynamicIndices = [];
const indicesCopy = [...dynamicSpecialIndices];
for (let i = 0; i < numDynamicSpecial; i++) {
    const randomIndex = Math.floor(Math.random() * indicesCopy.length);
    shuffledDynamicIndices.push(indicesCopy.splice(randomIndex, 1)[0]);
}

// 3. 創建最終的特殊格地圖 (包含固定角格和動態隨機格)
const allSpecialMap = { ...fixedCornerSquares };
shuffledDynamicIndices.forEach((index, i) => {
    if (dynamicTypesToAssign[i]) {
        const type = dynamicTypesToAssign[i];
        let name, color;
        if (type === 'BANK') { name = '銀行服務'; color = 'bg-yellow-200'; }
        else if (type === 'CHANCE') { name = '機會'; color = 'bg-orange-400'; }
        else if (type === 'FATE') { name = '命運'; color = 'bg-red-400'; }
        else if (type === 'CASINO') { name = 'Casino'; color = 'bg-green-500'; }

        allSpecialMap[index] = { name, type, color };
    }
});

// 4. 找出所有地產格子的位置，並創建地產物件
const propLocations = [];
for (let i = 0; i < totalSquares; i++) {
    if (!allSpecialMap[i]) {
        propLocations.push(i);
    }
}

const propSquares = [];
for (let i = 0; i < numProperties; i++) {
     const basePrice = 1000 + Math.floor(i / 10) * 500;
     const name = MELBOURNE_SUBURBS[i % MELBOURNE_SUBURBS.length]; 
     const color = ['bg-indigo-300', 'bg-sky-300', 'bg-teal-300', 'bg-pink-300'][(i) % 4];
     
     // ** NEW: 房產開發新增欄位 **
     const housePrice = Math.floor(basePrice * HOUSE_CONFIG.COST_MULTIPLIER);
     propSquares.push({ 
         index: -1, 
         name, 
         type: 'PROPERTY', 
         color, 
         owner: null, 
         houses: 0, // 0-4，4 表示最高級別（大樓）
         mortgage: false, 
         imageUrl: null, 
         price: basePrice, 
         rent: Math.floor(basePrice * 0.12), // 基礎租金
         housePrice: housePrice,
         rentMultipliers: HOUSE_CONFIG.RENT_MULTIPLIERS // [1, 3, 5, 7, 10]
     });
     // ** END NEW **
}

// 隨機打亂地產格子的內部數據
for (let i = propSquares.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [propSquares[i], propSquares[j]] = [propSquares[j], propSquares[i]];
}

// 5. 根據最終地圖和打亂後的地產格子填充 BOARD
let propIndexCounter = 0;
for (let i = 0; i < totalSquares; i++) {
     if (allSpecialMap[i]) {
         BOARD.push({ ...allSpecialMap[i], index: i }); 
     } else if (propIndexCounter < propSquares.length) { // 確保不會超出地產格的數量
         const prop = propSquares[propIndexCounter];
         BOARD.push({ ...prop, index: i }); 
         propIndexCounter++;
     } else {
         // 理論上不應發生，但作為保險
         BOARD.push({ index: i, name: `空置 #${i}`, type: 'EMPTY', color: 'bg-gray-100' });
     }
}

// --- 結束 5.1 修正 ---

const INITIAL_BOARD_STATE = BOARD.map(square => ({
     ...square, 
     imageUrl: square.imageUrl || null 
}));

// --- 3. 遊戲邏輯與狀態管理 ---

function fluctuateStockPrices(stocks) {
    const newStocks = stocks.map(stock => {
        // 修正：使用 settings.stocksConfig 中的 volatility，因為那是設定的來源
        const volatility = gameState.settings.stocksConfig.find(s => s.symbol === stock.symbol)?.volatility || stock.volatility;
        const fluctuation = Math.floor((Math.random() - 0.5) * volatility * 2);
        let newPrice = stock.price + fluctuation;
        const newSellPrice = Math.floor(newPrice * 0.8);
        newPrice = Math.max(newPrice, newSellPrice + 10);
        return { ...stock, price: newPrice, sellPrice: newSellPrice };
    });
    return newStocks;
}

function getInitialGameState(initialMoney = DEFAULT_INITIAL_MONEY) {
    const initialStocksHolding = STOCKS_INITIAL_CONFIG.reduce((acc, stock) => ({ ...acc, [stock.symbol]: 0 }), {});
    // FIX: 修正 reduce 箭頭函式參數的括號錯誤
    const initialPropertyImageUrls = INITIAL_BOARD_STATE.reduce((acc, square) => {
         if (square.type === 'PROPERTY') { acc[square.name] = null; }
         return acc;
     }, {});


    return {
        board: INITIAL_BOARD_STATE, 
        players: [
            // 初始狀態全部設為 false，只有 P0 會在初始化時被自動啟用
            { id: 'p0', name: PLAYER_NAMES[0], money: initialMoney, bank: 0, stocks: { ...initialStocksHolding }, position: 0, properties: [], isPlaying: false, inJail: false, jailTurns: 0, color: PLAYER_COLORS[0], currentUserId: null, avatarUrl: null, lastActiveTimestamp: Date.now(), trapCard: null }, // **NEW: trapCard 欄位**
            { id: 'p1', name: PLAYER_NAMES[1], money: initialMoney, bank: 0, stocks: { ...initialStocksHolding }, position: 0, properties: [], isPlaying: false, inJail: false, jailTurns: 0, color: PLAYER_COLORS[1], currentUserId: null, avatarUrl: null, lastActiveTimestamp: Date.now(), trapCard: null }, // **NEW: trapCard 欄位**
            { id: 'p2', name: PLAYER_NAMES[2], money: initialMoney, bank: 0, stocks: { ...initialStocksHolding }, position: 0, properties: [], isPlaying: false, inJail: false, jailTurns: 0, color: PLAYER_COLORS[2], currentUserId: null, avatarUrl: null, lastActiveTimestamp: Date.now(), trapCard: null }, // **NEW: trapCard 欄位**
            { id: 'p3', name: PLAYER_NAMES[3], money: initialMoney, bank: 0, stocks: { ...initialStocksHolding }, position: 0, properties: [], isPlaying: false, inJail: false, jailTurns: 0, color: PLAYER_COLORS[3], currentUserId: null, avatarUrl: null, lastActiveTimestamp: Date.now(), trapCard: null }, // **NEW: trapCard 欄位**
        ],
        turn: 0, 
        dice: [1, 1], // 初始骰子點數為 1, 1，方便顯示圖片
        status: 'READY', 
        log: [{ text: '新遊戲開始! 請設定遊玩人數並擲骰。', time: Date.now() }],
        activeUserIds: {}, 
        gameId: 'melbourne_monopoly_game',
        gameStarted: false, 
        currentStocks: STOCKS_INITIAL_CONFIG,
        pendingJoinRequests: {}, 
        settings: {
            interestRate: DEFAULT_INTEREST_RATE,
            stocksConfig: STOCKS_INITIAL_CONFIG, 
            propertyImageUrls: initialPropertyImageUrls, 
            initialMoney: DEFAULT_INITIAL_MONEY,
            joinApprovalRequired: true, 
            hotSwapMode: false, 
            suburbSummaries: {}, 
            // ** NEW: DEBUG 模式開關 (預設隱藏) **
            debugMode: false,
            casinoWinRate: 0.35
        },
        // **NEW: 新增 pendingAction 狀態來處理購買/陷害卡重開彈窗的需求**
        pendingAction: {
            type: 'none', // 'BUY_PROPERTY', 'USE_TRAP_CARD', 'BANK_SERVICE', 'CASINO_GAME', 'PROPERTY_MANAGEMENT'
            squareIndex: null,
            card: null, // 儲存陷害卡資訊
        },
        round: 1, // **NEW: 新增回合數**
    };
}

// **NEW: 計算租金的輔助函數**
function calculateRent(square) {
    // 這裡必須檢查 square.rentMultipliers 是否存在
    if (square.type !== 'PROPERTY' || square.mortgage || !square.rentMultipliers) return 0;
    
    // 房屋級別 (0=無房, 1=1房, 2=2房, 3=3房, 4=大樓)
    const level = square.houses; 
    // 確保 level 在有效範圍內
    const multiplier = square.rentMultipliers[level] || 1; 
    
    return square.rent * multiplier;
}


async function updateGameState(newState, logText = null) {
    try {
        if (!gameRef) {
            console.error('Firestore 參考未初始化.');
            return;
        }
        const newLog = [...newState.log];
        if (logText) {
            const time = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            newLog.unshift({ text: `[${time}] ${logText}`, time: Date.now() });
            while (newLog.length > 30) {
                newLog.pop();
            }
        }
        
        // NEW LOGIC: Update lastActiveTimestamp for the controlling user's player(s)
        const now = Date.now();
        newState.players = newState.players.map(p => {
            // 檢查當前用戶是否控制了這個玩家
            if (p.currentUserId === userId) {
                return { ...p, lastActiveTimestamp: now };
            }
            return p;
        });
        // END NEW LOGIC
        
        await setDoc(gameRef, { ...newState, log: newLog });
    } catch (error) {
        console.error('更新遊戲狀態失敗:', error);
        addLog(`**更新失敗**：無法寫入數據庫 (${error.message})`, 'error');
    }
}

function saveCurrentPlayerState(currentPlayer) {
    if (!gameState) return;
    const playerIndex = gameState.players.findIndex(p => p.id === currentPlayer.id);
    if (playerIndex === -1) return;

    gameState.players = gameState.players.map((p, index) => 
        index === playerIndex ? { 
            ...currentPlayer, 
            stocks: { ...currentPlayer.stocks },
            properties: [...currentPlayer.properties],
            trapCard: currentPlayer.trapCard ? { ...currentPlayer.trapCard } : null // **NEW: 確保陷害卡深拷貝**
        } : p
    );
}

/**
 * 結束回合 (已加入防止連點鎖定)
 */
async function endTurn() {
    // 【修正】防止重複點擊 / 連點
    if (isProcessingAction) return;
    isProcessingAction = true;

    // 嚴格限制狀態
    if (!gameState || (gameState.status !== 'ROLLED' && gameState.status !== 'ACTION_REQUIRED' && gameState.status !== 'READY')) {
// 狀態不對時直接解鎖並返回
isProcessingAction = false;
return;
    }
    
    const currentTurnPlayer = gameState.players[gameState.turn];
    
    // 檢查是否是自己的回合
    const isGameMasterDevice = gameState.players[0] && gameState.players[0].currentUserId === userId;
    const isHotSwapMode = gameState.settings?.hotSwapMode === true;
    let isMyTurn;
    if (isHotSwapMode && isGameMasterDevice) {
isMyTurn = true; 
    } else {
isMyTurn = currentTurnPlayer.currentUserId === userId; 
    }

    if (!isMyTurn) {
addLog(`錯誤：現在是 ${currentTurnPlayer.name} 的回合，您無法結束回合！`, 'error');
isProcessingAction = false; // 【修正】失敗時解鎖
return;
    }

    gameState.currentStocks = fluctuateStockPrices(gameState.currentStocks);
    
    saveCurrentPlayerState(currentTurnPlayer);
    
    
    // 【修正 1：監獄減計時 - 只在結束監獄玩家的回合時執行】
    if (currentTurnPlayer.inJail && currentTurnPlayer.jailTurns > 0) {
currentTurnPlayer.jailTurns--;
const remaining = currentTurnPlayer.jailTurns;
addLog(`${currentTurnPlayer.name} 監獄服刑中，本回合結束。剩餘 ${remaining} 回合。`);

// 如果服刑結束，標記出獄（下回合就能擲骰）
if (currentTurnPlayer.jailTurns === 0) {
    currentTurnPlayer.inJail = false;
    addLog(`${currentTurnPlayer.name} 監獄服刑期滿！下回合可正常擲骰。`);
}
saveCurrentPlayerState(currentTurnPlayer); // 保存更新後狀態
// 這裡不需要額外的 updateGameState，因為會在下面的邏輯中統一更新
    }
    
    
    let nextTurn = (gameState.turn + 1) % gameState.players.length;
    let nextPlayer = gameState.players[nextTurn];
    let newRound = gameState.round; // 保持當前回合數

    // **NEW: 檢查是否換輪**
    if (nextTurn === 0) {
newRound = gameState.round + 1; // 回合數加 1
    }
    // **END NEW**

    while (!nextPlayer.isPlaying) {
nextTurn = (nextTurn + 1) % gameState.players.length;
nextPlayer = gameState.players[nextTurn];

// **NEW: 再次檢查是否跳過輪數**
if (nextTurn === 0) {
    newRound = gameState.round + 1;
}

if (gameState.players.filter(p => p.isPlaying).length <= 1) {
    const finalWinner = gameState.players.find(p => p.isPlaying);
    addLog(`${finalWinner.name} 贏得了比賽! 遊戲結束回合。`, 'win');
    
    const nextState = { ...gameState, turn: nextTurn, status: 'WIN', pendingAction: { type: 'none', squareIndex: null, card: null } };
    await updateGameState(nextState);
    
    isProcessingAction = false; // 【修正】結束時解鎖
    return;
}
    }
    
    let nextTurnLog = `回合結束，輪到 ${nextPlayer.name} 擲骰。`;
    if (nextPlayer.inJail && nextPlayer.jailTurns > 0) {
nextTurnLog = `回合結束，輪到 ${nextPlayer.name} (監獄服刑中) 開始他的回合。`;
    }

    // **NEW: 傳遞新的回合數**
    const nextState = { ...gameState, turn: nextTurn, status: 'READY', round: newRound, pendingAction: { type: 'none', squareIndex: null, card: null } };
    await updateGameState(nextState, nextTurnLog);
    
    // 【修正】延遲解鎖，給 UI 更新和玩家反應的時間，防止誤觸下一回合
    isProcessingAction = false;
}

/**
 * 玩家擲骰 (已加入防止連點鎖定)
 */
async function rollDice() {
    // 【修正】防止重複點擊
    if (isProcessingAction) return;
    isProcessingAction = true;

    if (!gameState) {
addLog('遊戲狀態正在載入中，請稍候。', 'error');
isProcessingAction = false;
return;
    }

    if (!gameState.gameStarted) {
addLog('錯誤：遊戲尚未開始。請前往「👤 玩家管理」確認至少有 2 位玩家並儲存設定。', 'error');
isProcessingAction = false;
return;
    }

    if (gameState.status !== 'READY') {
addLog('錯誤：請先完成當前回合所需的動作（如購買、銀行操作或結束回合回合）。', 'error');
isProcessingAction = false;
return;
    }

    const currentPlayerIndex = gameState.turn;
    const currentPlayer = gameState.players[currentPlayerIndex];

    const isGameMasterDevice = gameState.players[0] && gameState.players[0].currentUserId === userId;
    const isHotSwapMode = gameState.settings?.hotSwapMode === true;
    let isMyTurn;
    if (isHotSwapMode && isGameMasterDevice) {
isMyTurn = true;
    } else {
isMyTurn = currentPlayer.currentUserId === userId;
    }
    
    if (!isMyTurn) {
addLog(`錯誤：現在是 ${currentPlayer.name} 的回合，請等待！`, 'error');
isProcessingAction = false;
return;
    }

// 【修正 1：監獄邏輯 - 擲骰階段（新版）】
if (currentPlayer.inJail && currentPlayer.jailTurns > 0) {
    // 只處理利息
    if (currentPlayer.bank > 0) {
const interestRate = gameState.settings.interestRate;
const interest = Math.round(currentPlayer.bank * interestRate);
currentPlayer.bank += interest; 
addLog(`${currentPlayer.name} 的定存獲得 $${interest.toLocaleString()} 利息。`);
saveCurrentPlayerState(currentPlayer); 
await updateGameState(gameState);
    }

    // 直接彈出提示，讓玩家按確認結束回合（傳入本回合開始時的剩餘回合數，不減）
    // showJailTurnModal 會處理後續的 endTurn
    showJailTurnModal(currentPlayer, currentPlayer.jailTurns);
    isProcessingAction = false; // 必須在顯示 Modal 後解除鎖定
    return; // 不擲骰，直接結束流程
} else if (currentPlayer.inJail && currentPlayer.jailTurns === 0) {
    // 刑期結束，可以正常擲骰
    currentPlayer.inJail = false;
    addLog(`${currentPlayer.name} 已離開監獄，開始本回合擲骰。`);
}
    
    // 正常回合的利息計算（非監獄中的玩家）
    if (currentPlayer.bank > 0 && !currentPlayer.inJail) {
const interestRate = gameState.settings.interestRate;
const interest = Math.round(currentPlayer.bank * interestRate);
currentPlayer.bank += interest; 
addLog(`${currentPlayer.name} 的定存獲得 $${interest.toLocaleString()} 利息。`);
saveCurrentPlayerState(currentPlayer); 
await updateGameState(gameState);
    }

    // =========================================================
    // NEW: DEBUG 邏輯
    const debugInput = document.getElementById('debug-steps-input');
    let dice1, dice2, steps;
    
    if (debugInput && debugInput.value.trim() !== '' && debugInput.style.display !== 'none') {
// 使用輸入框的數值
const inputSteps = parseInt(debugInput.value);
if (inputSteps >= 2 && inputSteps <= 12) {
    steps = inputSteps;
    // 為了動畫和 log 的一致性，計算出對應的 dice1 和 dice2
    dice1 = Math.min(6, steps - 1); // 假設 dice1 最大為 6
    dice2 = steps - dice1;
    if (dice2 > 6) { 
        dice2 = 6;
        dice1 = steps - 6;
    }
    // 確保骰子值在 1-6 範圍內
    dice1 = Math.max(1, Math.min(6, dice1));
    dice2 = Math.max(1, Math.min(6, dice2));

    addLog(`${currentPlayer.name} 偵錯模式使用步數: ${steps} 步。`, 'debug');
} else {
    addLog('偵錯步數無效 (需 2~12)，使用隨機擲骰。', 'error');
    dice1 = Math.floor(Math.random() * 6) + 1;
    dice2 = Math.floor(Math.random() * 6) + 1;
    steps = dice1 + dice2;
}
    } else {
// 正常隨機擲骰
dice1 = Math.floor(Math.random() * 6) + 1;
dice2 = Math.floor(Math.random() * 6) + 1;
steps = dice1 + dice2;
    }
    // =========================================================

    gameState.status = 'MOVING';

    currentPlayer.lastActiveTimestamp = Date.now(); // 更新時間
    
    await updateGameState(gameState, `${currentPlayer.name} 正在擲骰...`);

    await runDiceAnimation(dice1, dice2); 

    gameState.dice = [dice1, dice2];
    await updateGameState(gameState, `${currentPlayer.name} 擲出了 ${dice1} 和 ${dice2}，共 ${steps} 步。`);
    
    await animateMove(currentPlayerIndex, steps);
    
    // animateMove 會在落地操作顯示前解除鎖定。
} 
async function savePlayerSettings(players, newPlayerCount, currentTurn) {
    const currentPlayingCount = players.filter(p => p.isPlaying).length;
    let logText = '';
    
    // 處理人數和初始資產的變動
    for (let i = 0; i < players.length; i++) {
        const wasPlaying = players[i].isPlaying;
        const isNowPlaying = i < newPlayerCount;
        
        players[i].isPlaying = isNowPlaying;

        // 只有從禁用變為啟用時，才重設資產
        if (!wasPlaying && isNowPlaying) {
            const initialMoneyInput = document.getElementById(`player-initial-money-${i}`);
            const initialMoney = parseInt(initialMoneyInput.value) || DEFAULT_INITIAL_MONEY;
            
            players[i].money = initialMoney;
            players[i].bank = 0;
            players[i].position = 0;
            players[i].properties = [];
            players[i].inJail = false;
            players[i].jailTurns = 0;
            players[i].trapCard = null; // **NEW: 重置陷害卡**
            // 當玩家被重新啟用時，清除其綁定的用戶 ID，使其可被重新認領
            // 但保留 P0 的綁定狀態，因為它可能是管理員
            if (players[i].id !== 'p0') {
                players[i].currentUserId = null; 
            }
        }
        
        // 處理在玩家管理中手動清空綁定 (已移除手動輸入 UID 的功能，但保留 P0 的 ID)
        // P0 的 currentUserId 只能通過重啟/初始化來設置
        if (players[i].id === 'p0') {
            // 確保 P0 永遠啟用
            players[i].isPlaying = true;
        }
    }

    if (newPlayerCount !== currentPlayingCount) {
        if (currentTurn >= newPlayerCount) {
            currentTurn = 0;
        }
        logText = `玩家人數更改為 ${newPlayerCount}，回合已重設至 P${currentTurn+1}。`;
    }

    // 處理名稱、顏色和頭像 URL 變化
    let nameColorAvatarChanged = false;
    players.forEach((player, index) => {
        const nameInput = document.getElementById(`player-name-${index}`);
        const colorInput = document.querySelector(`input[name="player-${index}-color"]:checked`);
        const avatarUrlInput = document.getElementById(`player-avatar-url-${index}`); 

        if (nameInput && player.name !== nameInput.value.trim()) {
            player.name = nameInput.value.trim() || PLAYER_NAMES[index];
            nameColorAvatarChanged = true;
        }
        if (colorInput && player.color !== colorInput.value) {
            player.color = colorInput.value;
            nameColorAvatarChanged = true;
        }
        if (avatarUrlInput && player.avatarUrl !== (avatarUrlInput.value.trim() || null)) {
            player.avatarUrl = avatarUrlInput.value.trim() || null;
            nameColorAvatarChanged = true;
        }
        if (!PLAYER_COLORS.includes(player.color)) {
            player.color = PLAYER_COLORS[index];
        }
    });
    
    if (nameColorAvatarChanged && !logText) {
        logText = '玩家名稱、顏色或頭像已更新。';
    }
    if (!logText) {
        logText = '玩家設定已儲存。';
    }
    
    const isPlayingCount = players.filter(p => p.isPlaying).length;
    const gameStarted = isPlayingCount >= 2;
    if (gameStarted && !gameState.gameStarted) {
        logText += ' 遊戲已啟動！';
    }

    const nextState = {
        ...gameState,
        players: players.map(p => ({...p})), 
        turn: currentTurn,
        status: 'READY',
        gameStarted: gameStarted 
    };
    
    await updateGameState(nextState, logText);
}

/**
 * 顯示監獄回合彈窗 (修正 1: 確保確認後結束回合，且無取消按鈕)
 */
function showJailTurnModal(currentPlayer, turnsLeft) {
    // 【修正 1】將扣錢邏輯移到 rollDice 裡面，這裡只負責顯示
    const message = turnsLeft > 0 
? `<p class="text-lg">您仍在監獄中，本回合將被跳過。<br/>目前剩餘 <strong>${turnsLeft}</strong> 回合（本回合結束後減 1）。</p><p class="mt-2 text-sm text-red-600 font-semibold">點擊確認以結束本回合。</p>`
: `<p class="text-lg text-green-600 font-bold">恭喜！您已服刑完畢，下回合可正常擲骰及移動。</p>`;

    // 【監獄邏輯修正】確保點擊確認後，強制結束回合，且無取消按鈕
    showModal(
`[${currentPlayer.name}] 監獄狀態提示`, 
message,
// 確認按鈕的同步操作
() => { 
    const logMessage = turnsLeft > 0 
       ? `${currentPlayer.name} 確認回合跳過。` 
       : `${currentPlayer.name} 刑期結束，回合結束，下回合可擲骰。`;
    addLog(logMessage); 
    // 確保 Modal 關閉後再呼叫異步的 endTurn
    setTimeout(endTurn, 50); 
},
null,
turnsLeft > 0 ? '確認跳過回合' : '確認離開監獄'
    );
    // 監獄狀態提示，頂部關閉按鈕和取消按鈕都應該被禁用或隱藏，只允許通過確認按鈕繼續
    document.getElementById('modal-cancel-btn').classList.add('hidden');
    // 覆寫頂部關閉按鈕的行為，使其行為與確認按鈕相同
    document.getElementById('modal-top-close-btn').onclick = () => {
document.getElementById('modal').classList.add('hidden');
document.getElementById('modal').classList.remove('flex');
const logMessage = turnsLeft > 0 
   ? `${currentPlayer.name} 確認回合跳過 (點擊 X)。` 
   : `${currentPlayer.name} 刑期結束，回合結束，下回合可擲骰 (點擊 X)。`;
addLog(logMessage); 
setTimeout(endTurn, 50); 
    };
}


/**
 * 顯示稅務彈窗 (修正：將扣款邏輯移到確認按鈕內)
 */
function showTaxModal(currentPlayer, square, taxAmount) {
    
    // 🚨 修正：在這裡不執行 currentPlayer.money -= taxAmount;
    
    const beforeMoney = currentPlayer.money; // 稅款在彈窗確認時才扣除

    const message = `<p class="text-lg text-gray-800">您停在了 **${square.name}**！</p>
             <div class="mt-4 p-3 bg-red-50 rounded-lg border border-red-300">
                 <p class="text-sm">扣款前現金: <span class="font-bold text-gray-700">$${beforeMoney.toLocaleString()}</span></p>
                 <p class="text-sm font-bold text-red-600">應繳稅款: -$${taxAmount.toLocaleString()}</p>
                 <hr class="my-2 border-red-200"/>
                 <p class="text-lg font-extrabold text-red-700">扣款後餘額: $${(beforeMoney - taxAmount).toLocaleString()}</p>
             </div>
             <p class="mt-4 text-sm text-red-600 font-semibold">點擊確認以繼續。</p>`;

    showModal(
`[${currentPlayer.name}] 繳納稅款`, 
message,
// 確認按鈕的同步操作：在這裡執行扣款
() => { 
    // 執行實際扣款
    currentPlayer.money -= taxAmount;
    
    // 檢查是否破產
    if (currentPlayer.money < 0) {
        currentPlayer.money = 0;
        currentPlayer.isPlaying = false;
        // 這裡應該觸發破產處理，但為簡化，僅記錄日誌
        addLog(`${currentPlayer.name} 因無法支付稅款而**破產**！退出遊戲。`, 'error');
    }

    saveCurrentPlayerState(currentPlayer); 
    const logMessage = `${currentPlayer.name} 確認繳納 $${taxAmount.toLocaleString()} 的 ${square.name}。`;
    
    // 確保 Modal 關閉後再呼叫異步的 updateGameState/endTurn
    const nextState = { ...gameState, status: 'ROLLED', pendingAction: { type: 'none', squareIndex: null, card: null } };
    setTimeout(async () => {
        await updateGameState(nextState, logMessage);
        await endTurn();
    }, 50);
},
null,
'確認完成'
    );

    // ... (後續的 handleForcedPay 邏輯也需要包含扣款)
    const handleForcedPay = () => {
// ... 關閉 Modal 的邏輯

// 執行實際扣款 (與上方相同)
currentPlayer.money -= taxAmount;
if (currentPlayer.money < 0) {
    // ... 破產邏輯
}
saveCurrentPlayerState(currentPlayer); 

// ... 後續的 updateGameState/endTurn 邏輯
    };
    
    // ... 重新綁定頂部關閉按鈕
    document.getElementById('modal-top-close-btn').onclick = handleForcedPay;
}


/**
 * NEW: 骰子滾動動畫
 */
function runDiceAnimation(finalDice1, finalDice2) {
    const dice1El = document.getElementById('dice-display-1');
    const dice2El = document.getElementById('dice-display-2');
    const values = [1, 2, 3, 4, 5, 6];
    const duration = 950;
    const frameInterval = 65;

    Object.values(DICE_IMAGES).forEach(src => {
        const image = new Image();
        image.src = src;
    });

    const animations = [
        dice1El.animate([
            { transform: 'rotate(0deg) scale(1)' },
            { transform: 'rotate(180deg) scale(1.16)' },
            { transform: 'rotate(360deg) scale(1)' }
        ], { duration, easing: 'cubic-bezier(.22,.8,.25,1)' }),
        dice2El.animate([
            { transform: 'rotate(0deg) scale(1)' },
            { transform: 'rotate(-180deg) scale(1.16)' },
            { transform: 'rotate(-360deg) scale(1)' }
        ], { duration, easing: 'cubic-bezier(.22,.8,.25,1)' })
    ];

    return new Promise(resolve => {
        const startedAt = performance.now();
        let lastFrameAt = 0;
        const renderFrame = now => {
            const elapsed = now - startedAt;
            if (elapsed - lastFrameAt >= frameInterval) {
                lastFrameAt = elapsed;
                dice1El.src = DICE_IMAGES[values[Math.floor(Math.random() * values.length)]];
                dice2El.src = DICE_IMAGES[values[Math.floor(Math.random() * values.length)]];
            }
            if (elapsed < duration) {
                requestAnimationFrame(renderFrame);
                return;
            }
            animations.forEach(animation => animation.cancel());
            dice1El.src = DICE_IMAGES[finalDice1];
            dice2El.src = DICE_IMAGES[finalDice2];
            resolve();
        };
        requestAnimationFrame(renderFrame);
    });
}

async function animateMove(playerIndex, steps) {
    const initialPlayer = gameState.players[playerIndex];
    if (!initialPlayer) return;
    const playerId = initialPlayer.id;
    const startPosition = initialPlayer.position;

    for (let stepsTaken = 1; stepsTaken <= steps; stepsTaken++) {
        const previousToken = document.querySelector(
            `.player-token-inner[data-player-id="${CSS.escape(playerId)}"]`
        );
        const previousRect = previousToken?.getBoundingClientRect();
        const livePlayerIndex = gameState.players.findIndex(player => player.id === playerId);
        const livePlayer = gameState.players[livePlayerIndex];
        if (!livePlayer) return;

        livePlayer.position = (startPosition + stepsTaken) % totalSquares;
        if (livePlayer.position === 0 && stepsTaken < steps) {
            livePlayer.money += BOARD[0].action;
            addLog(`${livePlayer.name} 經過起點 (GO)，獲得 $${BOARD[0].action.toLocaleString()}。`);
        }

        renderPlayerStats();
        renderBoardDisplay();

        const nextToken = document.querySelector(
            `.player-token-inner[data-player-id="${CSS.escape(playerId)}"]`
        );
        const nextRect = nextToken?.getBoundingClientRect();
        if (previousRect && nextRect && nextToken) {
            const animation = nextToken.animate([
                { transform: `translate(${previousRect.left - nextRect.left}px, ${previousRect.top - nextRect.top}px) scale(.92)` },
                { transform: 'translate(0, 0) scale(1.08)', offset: 0.72 },
                { transform: 'translate(0, 0) scale(1)' }
            ], { duration: MOVE_DELAY, easing: 'cubic-bezier(.22,.8,.25,1)', fill: 'both' });
            await animation.finished.catch(() => {});
        } else {
            await new Promise(resolve => setTimeout(resolve, MOVE_DELAY));
        }

        document.getElementById(`square-${livePlayer.position}`)?.scrollIntoView({
            behavior: 'smooth', block: 'nearest', inline: 'center'
        });
    }

    const finalPlayerIndex = gameState.players.findIndex(player => player.id === playerId);
    const finalPlayer = gameState.players[finalPlayerIndex];
    if (!finalPlayer) return;
    saveCurrentPlayerState(finalPlayer);
    await updateGameState(gameState);
    isProcessingAction = false;
    await handleLandingAction(finalPlayerIndex);
}

async function handleLandingAction(currentPlayerIndex) {
    const currentPlayer = gameState.players[currentPlayerIndex];
    const newPosition = currentPlayer.position;
    const currentSquare = gameState.board[newPosition];
    let nextStatus = 'ROLLED'; 
    let logMessage = null;
    let shouldUpdateState = true; 
    
    // **NEW: 重置 pendingAction**
    gameState.pendingAction = { type: 'none', squareIndex: null, card: null };

    if (currentSquare.type === 'PROPERTY') {
        if (currentSquare.owner === null) {
            // === 無主地產：購買/放棄 ===
            logMessage = `${currentPlayer.name} 停在無主地產 ${currentSquare.name}，可選擇購買或直接結束回合。`;
            nextStatus = 'ROLLED';
            
            // 儲存待處理動作
            gameState.pendingAction = { type: 'BUY_PROPERTY', squareIndex: newPosition, card: null };
            
            // 彈出購買視窗（但不影響狀態，不會卡住）
            showPropertyBuyModal(currentPlayer, currentSquare); 
            
        } else if (currentSquare.owner !== currentPlayer.id && currentSquare.owner !== null) {
            // === 他人物產：支付租金 ===
            const rent = calculateRent(currentSquare);
            const ownerPlayer = gameState.players.find(p => p.id === currentSquare.owner);
            
            if (!ownerPlayer || !ownerPlayer.isPlaying) {
                logMessage = `${currentPlayer.name} 停在 ${currentSquare.name}，但地主已破產。免繳過路費。`;
                nextStatus = 'ROLLED';
            } else if (currentSquare.mortgage) {
                logMessage = `${currentPlayer.name} 停在 ${currentSquare.name}，但地產已抵押。免繳過路費。`;
                nextStatus = 'ROLLED';
            } else if (currentPlayer.money < rent) {
                // 破產機制
                currentPlayer.money = 0;
                currentPlayer.isPlaying = false;
                logMessage = `${currentPlayer.name} **破產**! 無法支付 $${rent.toLocaleString()} 房租給 ${ownerPlayer.name}，退出遊戲。`;
                saveCurrentPlayerState(currentPlayer);
                await updateGameState({ ...gameState, status: 'ROLLED' }, logMessage);
                endTurn(); 
                return; 
            } else {
                // 必須付租金 → 用 ACTION_REQUIRED + 彈窗（這是唯一會卡住的，但付錢後就過）
                // 這裡不執行扣款，留給 showRentModal 的確認環節執行，以保持交易彈窗的原子性
                showRentModal(currentPlayer, ownerPlayer, currentSquare, rent);
                shouldUpdateState = false;
                nextStatus = 'ACTION_REQUIRED';
            }
        } else {
            // ** 修正：踩到自己的地產，進行地產管理 **
            logMessage = `${currentPlayer.name} 停在自己的地產 ${currentSquare.name}。可進行地產管理。`;
            nextStatus = 'ROLLED'; // 狀態設為 ROLLED，允許結束回合
            
            // 儲存待處理動作
            gameState.pendingAction = { type: 'PROPERTY_MANAGEMENT', squareIndex: newPosition, card: null };
            
            // 彈出地產管理視窗
            showPropertyManagementModal(currentPlayer, currentSquare);
        }
    } else if (currentSquare.type === 'BANK') {
        // 新增：記錄 pendingAction
        gameState.pendingAction = { type: 'BANK_SERVICE', squareIndex: newPosition };
        
        showBankModal(currentPlayer);
        nextStatus = 'ROLLED';  // 改成 ROLLED，讓結束回合可點
        logMessage = `${currentPlayer.name} 停在銀行，可進行金融服務。`;
        shouldUpdateState = true;  // 允許更新狀態
    } else if (currentSquare.type === 'CASINO') {
        // 新增：記錄 pendingAction
        gameState.pendingAction = { type: 'CASINO_GAME', squareIndex: newPosition };
        
        showCasinoModal(currentPlayer);
        nextStatus = 'ROLLED';  // 改成 ROLLED
        logMessage = `${currentPlayer.name} 停在 Casino，可玩吃角子老虎機。`;
        shouldUpdateState = true;
    } else if (currentSquare.type === 'CHANCE') {
        const card = CHANCE_CARDS[Math.floor(Math.random() * CHANCE_CARDS.length)];
        
        if (card.type.startsWith('trap')) {
            // ** Trap card logic: Set ROLLED status, enable button, show modal (non-blocking) **
            currentPlayer.trapCard = card;
            gameState.pendingAction = { type: 'USE_TRAP_CARD', squareIndex: newPosition, card: card };
            logMessage = `${currentPlayer.name} 獲得陷害卡: ${card.text}，請在回合內選擇使用或放棄。`;
            showTrapTargetModal(currentPlayer, card); 
            nextStatus = 'ROLLED';
        } else {
            // ** FIX: Simple card logic: Apply effect immediately, show modal (non-blocking) **
            const result = applyCardEffect(currentPlayer, card); // Applies effect and calls saveCurrentPlayerState(currentPlayer)
            logMessage = result.logMsg;
            
            // Show modal as purely informational, set non-blocking flag (true)
            showCardModal(currentPlayer, result.cardMessage, 'CHANCE', true); 
            
            nextStatus = 'ROLLED';
            shouldUpdateState = true; // Allow final updateGameState call in handleLandingAction
        }
    } else if (currentSquare.type === 'FATE') {
        const card = FATE_CARDS[Math.floor(Math.random() * FATE_CARDS.length)];

        if (card.type.startsWith('trap')) {
            // ** Trap card logic: Same as CHANCE **
            currentPlayer.trapCard = card;
            gameState.pendingAction = { type: 'USE_TRAP_CARD', squareIndex: newPosition, card: card };
            logMessage = `${currentPlayer.name} 獲得陷害卡: ${card.text}，請在回合內選擇使用或放棄。`;
            showTrapTargetModal(currentPlayer, card); 
            nextStatus = 'ROLLED'; 
        } else {
            // ** FIX: Simple card logic: Apply effect immediately, show modal (non-blocking) **
            const result = applyCardEffect(currentPlayer, card);
            logMessage = result.logMsg;
            
            showCardModal(currentPlayer, result.cardMessage, 'FATE', true); // Show modal
            
            nextStatus = 'ROLLED';
            shouldUpdateState = true; 
        }
    } 
    // 【**修正 2**：踩到監獄格 (JAIL) 不入獄】
    else if (currentSquare.type === 'JAIL') {
         // 踩到監獄格不入獄，只是停留 (只用 GOTO_JAIL 入獄)
         logMessage = `${currentPlayer.name} 停在監獄 (Just Visiting)。`;
         nextStatus = 'ROLLED';
    }
    // 【**結束修正 2**】
    else if (currentSquare.type === 'INCOME_TAX') {
        const taxRate = currentSquare.action;
        const taxAmount = Math.round(currentPlayer.money * taxRate); // 10%
        
        // **問題 2 修正**：使用彈窗顯示交易過程，並將狀態設為 ACTION_REQUIRED 暫停回合
        showTaxModal(currentPlayer, currentSquare, taxAmount);
        shouldUpdateState = false; // 由 TaxModal 的確認按鈕處理 final updateGameState
        nextStatus = 'ACTION_REQUIRED';
    } else if (currentSquare.type === 'LUXURY_TAX') {
        const taxAmount = currentSquare.action;
        
        // **問題 2 修正**：使用彈窗顯示交易過程，並將狀態設為 ACTION_REQUIRED 暫停回合
        showTaxModal(currentPlayer, currentSquare, taxAmount);
        shouldUpdateState = false; // 由 TaxModal 的確認按鈕處理 final updateGameState
        nextStatus = 'ACTION_REQUIRED';
    } else if (currentSquare.type === 'START') {
        logMessage = `${currentPlayer.name} 停在起點。`;
        nextStatus = 'ROLLED';
    } else if (currentSquare.type === 'FINISH') {
        currentPlayer.money += currentSquare.action;
        logMessage = `${currentPlayer.name} 到達終點，獲得 $${currentSquare.action.toLocaleString()}！`;
        nextStatus = 'ROLLED';
    }

    if (shouldUpdateState) {
        const nextState = { ...gameState, status: nextStatus };
        await updateGameState(nextState, logMessage);
    }
}

// ** NEW: 核心卡片效果應用函數 (不觸發遊戲流程鎖定)**
function applyCardEffect(player, card) {
            let logMsg = card.text;
            
            if (card.type === 'money') {
                player.money += card.amount;
                logMsg += ` (金額變動: ${card.amount > 0 ? '+' : ''}$${card.amount.toLocaleString()})`;
            } else if (card.type === 'goto_jail') {
                const jailIndex = BOARD.findIndex(s => s.type === 'JAIL');
                player.position = jailIndex !== -1 ? jailIndex : player.position; 
                player.inJail = true;
                player.jailTurns = 3; 
                logMsg += ` (立即入獄)`;
            } else if (card.type === 'move_relative') {
                let newPos = (player.position + card.amount);
                if (newPos >= totalSquares) newPos %= totalSquares;
                else if (newPos < 0) newPos = totalSquares + newPos;
                player.position = newPos;
                logMsg += ` (移動到 ${BOARD[player.position].name}，不執行該地塊功能)`;
            } else if (card.type === 'move') {
        // **【步驟 1：處理經過起點的邏輯】**
        // 註：這段邏輯適用於所有 'move' 類型卡片，包括直接移動到終點 (127) 或起點 (0)
                if (card.target < player.position) {
                    player.money += BOARD[0].action;
            logMsg += ` (經過起點獲得 $${BOARD[0].action.toLocaleString()})`; // 新增日誌
                }
        
        // **【步驟 2：執行強制移動】**¸¸¸
                player.position = card.target % totalSquares;
        
        // **【步驟 3：處理卡片上的額外獎勵 (Fix: 解決瞬移到起點不加錢的問題)】**
        if (card.reward && card.reward > 0) {
            player.money += card.reward;
            logMsg += ` (卡片獎勵: +$${card.reward.toLocaleString()})`;
        }

        // **【步驟 4：更新日誌】**
                logMsg += ` (移動到 ${BOARD[player.position].name}，不執行該地塊功能)`;
            }
            
            // 立即儲存玩家狀態，確保狀態在 updateGameState 時被提交
            saveCurrentPlayerState(player); 

            return { logMsg, cardMessage: logMsg.replace(/<br\/>/g, ' ') };
        }
// ** END NEW **

/**
 * 顯示陷害卡目標選擇模態視窗 (新增/修正 2)
 */
function showTrapTargetModal(currentPlayer, card) {
    const isMyTurn = (gameState.settings?.hotSwapMode && gameState.players[0]?.currentUserId === userId) || (currentPlayer.currentUserId === userId); 

// --- 新增：處理 MOVING 狀態的重連修復 ---
    if (gameState.status === 'MOVING' && isMyTurn && !isProcessingAction) {
console.log("偵測到重連，正在繼續未完成的移動動畫...");
isProcessingAction = true; // 鎖定，防止重複觸發

// 取得骰子點數
const steps = gameState.dice[0] + gameState.dice[1];

// 這裡需要一個小技巧：animateMove 是從「目前位置」往後走 steps 步
// 但因為我們可能已經移動到一半存過檔，或者剛擲骰
// 為了安全，我們讓重連的人直接執行落地檢查，或從起點重新跑一次
setTimeout(async () => {
    // 呼叫落地處理（這會將狀態轉為 ROLLED 或 ACTION_REQUIRED）
    await handleLandingAction(currentPlayerIndex);
    isProcessingAction = false;
}, 1000);
return; 
    }
    // --- 結束 MOVING 修復 ---
    
    if (!isMyTurn) {
        // 非當前玩家只顯示卡片內容
        showCardModal(currentPlayer, card.text, card.type.includes('chance') ? 'CHANCE' : 'FATE', true);
        return;
    }

    const availableTargets = gameState.players.filter(p => p.isPlaying && p.id !== currentPlayer.id);
    
    const targetOptionsHtml = availableTargets.map(target => {
        return `
            <button data-target-id="${target.id}" class="select-target-btn w-full py-3 px-4 mb-2 rounded-lg text-lg font-bold text-white bg-red-500 hover:bg-red-600 transition duration-150">
                😈 陷害 ${target.name}
            </button>
        `;
    }).join('');

    const contentHtml = `
        <div id="trap-card-content">
            <p class="text-xl font-bold text-red-600 mb-4">${card.text.replace('**陷害卡** - ', '')}</p>
            ${availableTargets.length > 0 ? targetOptionsHtml : '<p class="text-lg font-semibold text-gray-500">沒有其他玩家在遊戲中，無法使用陷害卡。</p>'}
        </div>
    `;
    
    showModal(
        `[${currentPlayer.name}] 選擇陷害目標`,
        `您抽到了一張陷害卡，請選擇要陷害的對象：`,
        // 預設確認按鈕的行為 (當沒有目標時)
        () => { 
            if (availableTargets.length === 0) {
                performTrapCardAction(currentPlayer, null, card, '放棄');
            }
        },
        contentHtml,
        availableTargets.length > 0 ? '完成/稍後使用 (放棄陷害卡)' : '確認放棄陷害卡' // 修正按鈕文字
    );

    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');
    const topCloseBtn = document.getElementById('modal-top-close-btn');

    // 對於陷害卡，確認按鈕預設為放棄，只有當沒有目標時會執行放棄邏輯
    if (availableTargets.length > 0) {
        confirmBtn.textContent = '完成/稍後使用 (放棄陷害卡)';
        confirmBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
        confirmBtn.classList.add('bg-gray-600', 'hover:bg-gray-700');
        
        // **修正：確認/放棄按鈕和 X 按鈕都執行放棄邏輯**
        const handleForfeit = () => performTrapCardAction(currentPlayer, null, card, '放棄');
        confirmBtn.onclick = handleForfeit;
        cancelBtn.onclick = handleForfeit;
        topCloseBtn.onclick = handleForfeit;
        cancelBtn.classList.remove('hidden'); // 確保取消按鈕可見
    } else {
        // 沒有目標，按鈕只有一個：確認放棄
        cancelBtn.classList.add('hidden');
        confirmBtn.classList.remove('bg-gray-600', 'hover:bg-gray-700');
        confirmBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
        const handleForfeitNoTarget = () => performTrapCardAction(currentPlayer, null, card, '放棄');
        confirmBtn.onclick = handleForfeitNoTarget;
        topCloseBtn.onclick = handleForfeitNoTarget;
    }

    // 綁定目標選擇按鈕
    document.querySelectorAll('.select-target-btn').forEach(button => {
        button.onclick = () => {
            const targetId = button.dataset.targetId;
            const targetPlayer = gameState.players.find(p => p.id === targetId);
            if (targetPlayer) {
                performTrapCardAction(currentPlayer, targetPlayer, card, '使用');
            }
        };
    });
}

/**
 * 執行陷害卡動作並結束回合 (新增/修正 2)
 */
async function performTrapCardAction(currentPlayer, targetPlayer, card, actionType) {
    
    document.getElementById('modal').classList.add('hidden');
    document.getElementById('modal').classList.remove('flex');

    let logMsg = '';
    
    if (actionType === '使用' && targetPlayer) {
        // 陷害卡使用邏輯
        if (card.type === 'trap_money') {
            const amount = card.amount * -1; // 罰款是負值，這裡轉為正值
            
            if (targetPlayer.money < amount) {
                targetPlayer.money = 0;
                targetPlayer.isPlaying = false;
                logMsg = `${currentPlayer.name} 對 ${targetPlayer.name} 使用陷害卡！${targetPlayer.name} 無法支付 $${amount.toLocaleString()} 罰款而 **破產**！`;
            } else {
                targetPlayer.money -= amount;
                logMsg = `${currentPlayer.name} 對 ${targetPlayer.name} 使用陷害卡，${targetPlayer.name} 支付了 $${amount.toLocaleString()} 罰款。`;
            }
            saveCurrentPlayerState(targetPlayer);
            
        } else if (card.type === 'trap_jail') {
            const jailIndex = BOARD.findIndex(s => s.type === 'JAIL');
            targetPlayer.position = jailIndex !== -1 ? jailIndex : targetPlayer.position; 
            targetPlayer.inJail = true;
            targetPlayer.jailTurns = 3; 
            logMsg = `${currentPlayer.name} 對 ${targetPlayer.name} 使用陷害卡，將 ${targetPlayer.name} 送入監獄 (Jail)！`;
            saveCurrentPlayerState(targetPlayer);
        }
        
        // 清除陷害卡
        currentPlayer.trapCard = null;
        saveCurrentPlayerState(currentPlayer);
        
    } else if (actionType === '放棄') {
        logMsg = `${currentPlayer.name} 選擇放棄使用陷害卡 (回合結束時自動銷毀)。`;
        currentPlayer.trapCard = null; // 清除陷害卡
        saveCurrentPlayerState(currentPlayer);
    }

    // ** NEW: 清除 pendingAction 並結束回合 **
    const nextState = { ...gameState, status: 'ROLLED', pendingAction: { type: 'none', squareIndex: null, card: null } };
    setTimeout(async () => {
        await updateGameState(nextState, logMsg);
        await endTurn();
    }, 50);
}


function showRentModal(payer, receiver, square, amount) {
    
    // 房屋數量顯示
    const houseCount = square.houses;
    let houseText = '無房屋 (基礎租金)';
    if (houseCount === HOUSE_CONFIG.MAX_HOUSES) {
         houseText = '豪華大樓 🏢';
    } else if (houseCount === 3) {
         houseText = '高級公寓 🏢';
    } else if (houseCount === 2) {
         houseText = '中級公寓 🏠';
    } else if (houseCount === 1) {
         houseText = '一間房屋 🏡';
    }
    
    // 計算扣款前的餘額
    const beforeMoney = payer.money;
    
    // 這裡執行扣款和加錢
    payer.money -= amount;
    receiver.money += amount;
    
    const message = `${payer.name} 停在了 ${square.name} (${houseText})，這是 ${receiver.name} 的地產。<br/>
                     您需要支付 <span class="text-red-600 font-bold">$${amount.toLocaleString()}</span> 過路費。
                     <div class="mt-4 p-3 bg-red-50 rounded-lg border border-red-300">
                        <p class="text-sm">扣款前現金: <span class="font-bold text-gray-700">$${beforeMoney.toLocaleString()}</span></p>
                        <p class="text-sm font-bold text-red-600">應繳租金: -$${amount.toLocaleString()}</p>
                        <hr class="my-2 border-red-200"/>
                        <p class="text-lg font-extrabold text-red-700">扣款後餘額: $${payer.money.toLocaleString()}</p>
                     </div>`;
    
    showModal(
        `[${payer.name}] 支付過路費確認`,
        message,
        () => {
            saveCurrentPlayerState(payer);
            saveCurrentPlayerState(receiver);
            
            const logMessage = `${payer.name} 向 ${receiver.name} 支付了 $${amount.toLocaleString()} 房租。`;
            // 必須在 Modal 關閉後調用 updateGameState/endTurn
            const nextState = { ...gameState, status: 'ROLLED', pendingAction: { type: 'none', squareIndex: null, card: null } };
            setTimeout(async () => {
                await updateGameState(nextState, logMessage);
                await endTurn();
            }, 50);
        },
        null,
        '確認支付'
    );

    // **修復：點擊 X 也強制支付 + 結束回合（無法逃避房租，回合不卡）**
    const handleForcedPay = () => {
        document.getElementById('modal').classList.add('hidden');
        document.getElementById('modal').classList.remove('flex');
        saveCurrentPlayerState(payer);
        saveCurrentPlayerState(receiver);
        const logMessage = `${payer.name} 向 ${receiver.name} 支付了 $${amount.toLocaleString()} 房租 (點擊 X 關閉視窗)。`;
        const nextState = { ...gameState, status: 'ROLLED', pendingAction: { type: 'none', squareIndex: null, card: null } };
        setTimeout(async () => {
            await updateGameState(nextState, logMessage);
            await endTurn();
        }, 50);
    };
    document.getElementById('modal-top-close-btn').onclick = handleForcedPay;
}

/**
 * 購買地產核心邏輯 (在 Modal 內被調用)
 */
async function performBuyProperty(player, square) {
     const price = square.price;
     
     player.money -= price;
     const newBoard = gameState.board.map((s, index) => {
         if (index === square.index) {
             // 確保地產狀態在 board 陣列中被更新 (owner, houses, mortgage)
             return { ...s, owner: player.id, houses: s.houses || 0, mortgage: s.mortgage || false };
         }
         return s;
     });

     player.properties.push(square.name);

     saveCurrentPlayerState(player);
     // **NEW: 清除 pendingAction**
     const nextState = { ...gameState, board: newBoard, status: 'ROLLED', pendingAction: { type: 'none', squareIndex: null, card: null } };
     await updateGameState(nextState, `${player.name} 購買了 ${square.name}，支付 $${price.toLocaleString()}。`);
     
     // ** Bug 2 修正: 購買成功後，在 Modal 關閉後呼叫 endTurn **
     await endTurn(); 
}

/**
 * 顯示地產購買/簡介模態視窗 (NEW)
 */
async function showPropertyBuyModal(currentPlayer, currentSquare) {
    
     const price = currentSquare.price;
     const canAfford = currentPlayer.money >= price;
     
     const modalTitle = `[${currentPlayer.name}] 購買地產: ${currentSquare.name}`; 
     const defaultPlaceholderUrl = `https://placehold.co/300x200/4f46e5/ffffff?text=${encodeURIComponent(currentSquare.name + ' (Placeholder)')}`;
     const displayUrl = currentSquare.imageUrl || defaultPlaceholderUrl;
     
     let initialSummaryHtml = `<div class="text-center py-4 text-indigo-600 font-semibold">
                                   <span class="animate-spin inline-block w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full mr-2"></span>
                                    載入 ${currentSquare.name} 的簡介...
                                 </div>`;
     
     // 檢查緩存
     const cachedSummary = gameState.settings?.suburbSummaries?.[currentSquare.name];
     if (cachedSummary) {
         initialSummaryHtml = `<p class="text-base text-gray-600">${cachedSummary.text}</p>`;
     }
     
     const contentTemplate = `
         <div class="space-y-4">
             <div class="p-3 bg-gray-100 rounded-lg text-center border-2 border-dashed border-gray-300">
                        <p class="text-sm text-gray-500 mb-2">地產圖片</p>
                        <img id="property-modal-image" src="${displayUrl}" 
                              onerror="this.onerror=null;this.src='${defaultPlaceholderUrl}'"
                              alt="Image for ${currentSquare.name}" class="mt-2 mx-auto rounded w-full h-auto max-h-48 object-cover"/>
             </div>

             <div class="bg-indigo-50 p-3 rounded-lg">
                        <p class="text-lg font-bold text-indigo-700">價格: $${price.toLocaleString()}</p>
                        <p class="text-sm text-gray-600">基礎租金 (無房屋): $${currentSquare.rent.toLocaleString()}</p>
                        <p class="text-sm text-gray-600">房屋/升級成本: $${currentSquare.housePrice.toLocaleString()}</p>
                        <p class="text-sm text-gray-600">您的現金: $${currentPlayer.money.toLocaleString()}</p>
             </div>
             
             <div id="summary-and-source-area" class="max-h-32 overflow-y-auto pr-1">
                         ${initialSummaryHtml}
             </div>
             
             ${!canAfford ? `<p class="text-xl text-red-600 font-extrabold text-center mt-4">Oops！買不起！現金不足！</p>` : ''}
         </div>
     `;
     
     showModal(
         modalTitle, 
         `您停在了無主地產 ${currentSquare.name}，請決定是否購買：`,
         // **將 Action 改為同步函式，以避免 Bug 2 的問題**
         () => { 
             // Confirm Action: 購買地產
             if (canAfford) {
                 // 延遲執行異步購買和結束回合，確保 Modal 已經關閉
                 setTimeout(() => performBuyProperty(currentPlayer, currentSquare), 50); 
             } else {
                 // 如果錢不夠，確認按鈕是「確認離開」，僅結束回合
                 setTimeout(async () => {
                     // **NEW: 清除 pendingAction**
                     await updateGameState({ ...gameState, status: 'ROLLED', pendingAction: { type: 'none', squareIndex: null, card: null } }, `${currentPlayer.name} 因現金不足，放棄購買 ${currentSquare.name}。`);
                     await endTurn();
                 }, 50);
             }
         },
         contentTemplate,
         canAfford ? `購買 ($${price.toLocaleString()})` : '確認離開' 
     );
     
     // 處理取消 (不購買)
     const cancelBtn = document.getElementById('modal-cancel-btn');
     cancelBtn.textContent = '放棄購買/取消';
     cancelBtn.classList.remove('hidden');
     // ** Bug 1 & 2 修正：處理放棄購買/取消邏輯 **
     const handleCancelOrClose = async () => {
          document.getElementById('modal').classList.add('hidden');
          document.getElementById('modal').classList.remove('flex');
         
          // **確保 status 設為 ROLLED 並呼叫 endTurn**
          // **NEW: 清除 pendingAction**
          setTimeout(async () => {
              await updateGameState({ ...gameState, status: 'ROLLED', pendingAction: { type: 'none', squareIndex: null, card: null } }, `${currentPlayer.name} 決定放棄購買 ${currentSquare.name}。`);
              await endTurn();
          }, 50);
     };
     
     // ** Bug 1 修正：點擊 X 關閉按鈕時，執行相同的邏輯**
     document.getElementById('modal-top-close-btn').onclick = handleCancelOrClose;
     cancelBtn.onclick = handleCancelOrClose;
     
     if (!canAfford) {
         // 如果買不起，禁用購買按鈕，並將確認按鈕變成取消按鈕的行為
         const confirmBtn = document.getElementById('modal-confirm-btn');
         confirmBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
         confirmBtn.classList.add('bg-gray-400', 'hover:bg-gray-500');
         cancelBtn.classList.add('hidden'); // 既然確認按鈕已經是取消行為了，隱藏另一個取消按鈕
         // ** Bug 1 修正：在買不起的情況下，確認按鈕的行為與取消相同**
         confirmBtn.onclick = handleCancelOrClose;
     }
     
     // --- Async load/cache logic for summary ---
     if (!cachedSummary) {
         try {
             const summary = await fetchSuburbSummary(currentSquare.name);
             
             // 成功：更新 UI
             const container = document.getElementById('summary-and-source-area');
             if (container) {
                 container.innerHTML = `<p class="text-base text-gray-600">${summary.text}</p>`;
             }
             
             // 成功：更新緩存並儲存到 Firestore (只更新狀態，不寫日誌)
             gameState.settings.suburbSummaries = {
                 ...gameState.settings.suburbSummaries,
                 [currentSquare.name]: { text: summary.text, sources: summary.sources || [] }
             };
             await updateGameState(gameState); 
         
         } catch (error) {
             const errorMessage = `載入簡介失敗: ${error.message}`;
             const container = document.getElementById('summary-and-source-area');
             if (container) {
                  container.innerHTML = `<p class="text-red-500 font-bold">載入簡介失敗</p><p class="text-sm mt-2">${errorMessage}</p>`;
             }
             console.error("Gemini API Call Failed:", error);
         }
     }
     // --- End Async load/cache logic ---
}

// --- NEW: 地產管理相關函式 (包含房屋建造和抵押/贖回) ---

/**
 * 顯示地產管理模態視窗
 */
async function showPropertyManagementModal(currentPlayer, currentSquare) {
     const squareIndex = currentSquare.index;
     
     const isMyTurn = (gameState.settings?.hotSwapMode && gameState.players[0]?.currentUserId === userId) || (currentPlayer.currentUserId === userId);
     
     if (!isMyTurn) {
         addLog('錯誤：現在不是您的回合，無法進行地產管理。', 'error');
         return;
     }

     // 確保 modal 內容是即時的
     const renderModalContent = (player, square) => {
         // ** 關鍵修正：確保 square 物件是 Board 中該地塊的最新狀態 **
         const boardSquare = gameState.board.find(s => s.index === square.index);
         const housePrice = boardSquare.housePrice;
         const currentHouses = boardSquare.houses; // 0-4
         const maxHouses = HOUSE_CONFIG.MAX_HOUSES; // 4
         
         // 房屋狀態描述
         const houseDescriptions = ['空地', '房屋 🏡', '公寓 (2房) 🏠', '豪華公寓 (3房) 🏢', '大樓 (4房) 🏢'];
         const currentRent = calculateRent(boardSquare);
         
         const buyPrice = housePrice;
         const sellPrice = Math.floor(housePrice * 0.5); // 賣出價格為成本的一半
         const canBuy = player.money >= buyPrice && currentHouses < maxHouses;
         const canSell = currentHouses > 0;
         
         // 抵押相關
         const mortgageValue = Math.floor(boardSquare.price * HOUSE_CONFIG.MORTGAGE_MULTIPLIER);
         const releaseMortgageCost = Math.floor(mortgageValue * (1 + HOUSE_CONFIG.MORTGAGE_SELL_TAX));
         const canMortgage = !boardSquare.mortgage && currentHouses === 0; // 必須清空房屋才能抵押
         const canRelease = boardSquare.mortgage && player.money >= releaseMortgageCost;

         const houseStatusHtml = `
              <div class="p-3 bg-indigo-50 rounded-lg shadow-inner">
                     <p class="text-lg font-bold text-indigo-700 mb-2">${boardSquare.name} (${houseDescriptions[currentHouses]})</p>
                     <div class="flex justify-between text-sm text-gray-700">
                         <span>當前租金:</span>
                         <span class="font-bold text-red-600">$${currentRent.toLocaleString()}</span>
                     </div>
                     <div class="flex justify-between text-sm text-gray-700">
                         <span>地產價值 (基礎):</span>
                         <span class="font-bold">$${boardSquare.price.toLocaleString()}</span>
                     </div>
                     <div class="flex justify-between text-sm text-gray-700">
                         <span>房屋/升級成本 (每級):</span>
                         <span class="font-bold">$${housePrice.toLocaleString()}</span>
                     </div>
                     <div class="flex justify-between text-sm text-gray-700">
                         <span>抵押價值:</span>
                         <span class="font-bold">$${mortgageValue.toLocaleString()}</span>
                     </div>
                     <div class="flex justify-between text-sm text-gray-700 mt-2">
                         <span>您的現金:</span>
                         <span id="mgmt-cash" class="font-bold text-green-700">$${player.money.toLocaleString()}</span>
                     </div>
              </div>
         `;
         
         const actionButtonsHtml = `
              <div class="mt-4 border-t pt-4">
                     <p class="font-bold text-gray-700 mb-2">房屋/升級管理 (${currentHouses} / ${maxHouses})</p>
                     ${boardSquare.mortgage ? 
                         `<p class="text-red-600 font-bold mb-2">🚨 地產已抵押，無法進行房屋交易！</p>` : ''}
                     <div class="flex space-x-2">
                         <button id="buy-house-btn" class="py-2 px-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition duration-150 flex-grow disabled:opacity-50"
                                 ${!canBuy || boardSquare.mortgage ? 'disabled' : ''} data-price="${buyPrice}">
                             ${currentHouses === 0 ? '蓋房屋' : (currentHouses === maxHouses - 1 ? '蓋大樓' : '升級')} ($${buyPrice.toLocaleString()})
                         </button>
                         <button id="sell-house-btn" class="py-2 px-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition duration-150 flex-grow disabled:opacity-50"
                                 ${!canSell || boardSquare.mortgage ? 'disabled' : ''} data-price="${sellPrice}">
                             賣出/降級 ($${sellPrice.toLocaleString()})
                         </button>
                     </div>
                     <p id="house-msg" class="text-xs text-red-500 mt-2 font-semibold"></p>
              </div>
              
              <div class="mt-4 border-t pt-4">
                     <p class="font-bold text-gray-700 mb-2">財務管理 (${boardSquare.mortgage ? '抵押中 🔒' : '未抵押'})</p>
                     <div class="flex space-x-2">
                         ${boardSquare.mortgage ? 
                             `<button id="release-mortgage-btn" class="py-2 px-3 bg-yellow-600 text-gray-900 rounded-lg hover:bg-yellow-700 transition duration-150 flex-grow disabled:opacity-50"
                                      ${!canRelease ? 'disabled' : ''} data-price="${releaseMortgageCost}">
                                 贖回抵押 ($${releaseMortgageCost.toLocaleString()})
                             </button>` :
                             `<button id="mortgage-btn" class="py-2 px-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition duration-150 flex-grow disabled:opacity-50"
                                      ${!canMortgage ? 'disabled' : ''} data-price="${mortgageValue}">
                                 抵押地產 ($${mortgageValue.toLocaleString()})
                             </button>`
                          }
                     </div>
                     ${!canMortgage && !boardSquare.mortgage ? 
                         `<p class="text-xs text-red-500 mt-2 font-semibold">⚠️ 抵押前必須先賣掉所有 ${currentHouses} 間房屋/建築！</p>` : ''}
                     ${boardSquare.mortgage && !canRelease ? 
                         `<p class="text-xs text-red-500 mt-2 font-semibold">贖回抵押需要現金 $${releaseMortgageCost.toLocaleString()}。</p>` : ''}
                     <p id="mortgage-msg" class="text-xs text-red-500 mt-2 font-semibold"></p>
              </div>
         `;
         
         return houseStatusHtml + actionButtonsHtml;
     };
     
     // 首次顯示 Modal
     showModal(
         `[${currentPlayer.name}] 地產管理: ${currentSquare.name}`, 
         '請選擇對您的地產進行房屋升級/降級或抵押/贖回操作。',
         // **將 Action 改為同步函式，以避免 Bug 2 的問題**
         () => {
              // Confirm Action: 僅關閉 Modal 並結束回合
              // **NEW: 清除 pendingAction**
              setTimeout(async () => {
                  await updateGameState({ ...gameState, status: 'ROLLED', pendingAction: { type: 'none', squareIndex: null, card: null } }, `${currentPlayer.name} 完成地產管理。`);
                  await endTurn();
              }, 50);
         },
         renderModalContent(currentPlayer, currentSquare),
         '完成管理'
     );
     
     // 處理取消 (同完成管理)
     document.getElementById('modal-cancel-btn').classList.remove('hidden');
     const handleExitManagement = async () => {
          document.getElementById('modal').classList.add('hidden');
          document.getElementById('modal').classList.remove('flex');
         
          // **確保 status 設為 ROLLED 並呼叫 endTurn**
          // **NEW: 清除 pendingAction**
          setTimeout(async () => {
              await updateGameState({ ...gameState, status: 'ROLLED', pendingAction: { type: 'none', squareIndex: null, card: null } }, `${currentPlayer.name} 退出地產管理。`);
              await endTurn();
          }, 50);
     };
     document.getElementById('modal-top-close-btn').onclick = handleExitManagement;
     document.getElementById('modal-cancel-btn').onclick = handleExitManagement;


     // *** 房屋/升級購買邏輯 (問題 3 修正) ***
     document.getElementById('buy-house-btn').onclick = async () => {
         const price = parseInt(document.getElementById('buy-house-btn').dataset.price);
         const houseMsg = document.getElementById('house-msg');
         
         // 重新獲取最新的 square 狀態
         const latestSquare = gameState.board.find(s => s.index === currentSquare.index);
         
         if (currentPlayer.money < price) {
             houseMsg.textContent = '錯誤：現金不足以支付升級費用！';
             return;
         }
         // 檢查是否已達最高等級
         if (latestSquare.houses >= HOUSE_CONFIG.MAX_HOUSES) {
             houseMsg.textContent = '錯誤：已達最高升級級別（大樓）！';
             return;
         }
         
         currentPlayer.money -= price;
         // **問題 3 修正：直接更新 board 內該地塊的引用**
         latestSquare.houses++;
         
         saveCurrentPlayerState(currentPlayer);
         const houseDescriptions = ['空地', '房屋 🏡', '公寓 (2房) 🏠', '豪華公寓 (3房) 🏢', '大樓 (4房) 🏢'];
         const houseDescription = houseDescriptions[latestSquare.houses];
         const logMsg = `${currentPlayer.name} 升級了 ${latestSquare.name} 到 ${houseDescription}，花費 $${price.toLocaleString()}。`;
         
         // 強制更新狀態到 Firestore (同步操作)
         await updateGameState(gameState, logMsg);

         // 重新渲染 Modal 內容以更新狀態和按鈕 (問題 3 修正)
         document.getElementById('modal-content').innerHTML = renderModalContent(currentPlayer, latestSquare);
         // 重新綁定事件
         bindManagementEvents(currentPlayer, latestSquare);
         addLog(logMsg);
     };

     // *** 房屋/升級出售邏輯 (問題 4 修正) ***
     document.getElementById('sell-house-btn').onclick = async () => {
         const price = parseInt(document.getElementById('sell-house-btn').dataset.price);
         const houseMsg = document.getElementById('house-msg');

         // 重新獲取最新的 square 狀態
         const latestSquare = gameState.board.find(s => s.index === currentSquare.index);

         if (latestSquare.houses <= 0) {
             houseMsg.textContent = '錯誤：地產上沒有可出售的房屋/建築！';
             return;
         }
         
         currentPlayer.money += price;
         // **問題 4 修正：直接更新 board 內該地塊的引用**
         latestSquare.houses--;
         
         // 更新 gameState.board 中的 square
         
         saveCurrentPlayerState(currentPlayer);
         const houseDescriptions = ['空地', '房屋 🏡', '公寓 (2房) 🏠', '豪華公寓 (3房) 🏢', '大樓 (4房) 🏢'];
         const houseDescription = houseDescriptions[latestSquare.houses]; // 賣掉後的新狀態 (currentSquare.houses 已是新值)
         const logMsg = `${currentPlayer.name} 賣出/降級了 ${latestSquare.name} 到 ${houseDescription}，獲得 $${price.toLocaleString()}。`;
         
         // 強制更新狀態到 Firestore (同步操作)
         await updateGameState(gameState, logMsg);

         // 重新渲染 Modal 內容以更新狀態和按鈕 (問題 4 修正)
         document.getElementById('modal-content').innerHTML = renderModalContent(currentPlayer, latestSquare);
         // 重新綁定事件
         bindManagementEvents(currentPlayer, latestSquare);
         addLog(logMsg);
     };
     
     // *** 抵押/贖回邏輯 (問題 4, 5 修正) ***
     function bindManagementEvents(player, square) {
         const mortgageBtn = document.getElementById('mortgage-btn');
         if (mortgageBtn) {
             mortgageBtn.onclick = async () => {
                 const value = parseInt(mortgageBtn.dataset.price);
                 const mortgageMsg = document.getElementById('mortgage-msg');

                 if (square.houses > 0) {
                     mortgageMsg.textContent = '錯誤：抵押前必須先賣掉所有房屋/建築！';
                     return;
                 }

                 player.money += value;
                 // **問題 5 修正：直接更新 board 內該地塊的引用**
                 square.mortgage = true;
                 
                 saveCurrentPlayerState(player);
                 const logMsg = `${player.name} 抵押了 ${square.name}，獲得 $${value.toLocaleString()}。`;
                 await updateGameState(gameState, logMsg);
                 
                 // 重新渲染 Modal 內容
                 document.getElementById('modal-content').innerHTML = renderModalContent(player, square);
                 bindManagementEvents(player, square); // 重新綁定
                 addLog(logMsg);
             };
         }
         
         const releaseMortgageBtn = document.getElementById('release-mortgage-btn');
         if (releaseMortgageBtn) {
             releaseMortgageBtn.onclick = async () => {
                 const cost = parseInt(releaseMortgageBtn.dataset.price);
                 const mortgageMsg = document.getElementById('mortgage-msg');

                 if (player.money < cost) {
                     mortgageMsg.textContent = `錯誤：現金不足以支付贖回費用 $${cost.toLocaleString()}！`;
                     return;
                 }

                 player.money -= cost;
                 // **問題 5 修正：直接更新 board 內該地塊的引用**
                 square.mortgage = false;
                 
                 saveCurrentPlayerState(player);
                 const logMsg = `${player.name} 贖回了 ${square.name}，支付 $${cost.toLocaleString()}。`;
                 await updateGameState(gameState, logMsg);
                 
                 // 重新渲染 Modal 內容
                 document.getElementById('modal-content').innerHTML = renderModalContent(player, square);
                 bindManagementEvents(player, square); // 重新綁定
                 addLog(logMsg);
             };
         }

         // 確保房屋/升級按鈕也被重新綁定
         document.getElementById('buy-house-btn').onclick = document.getElementById('buy-house-btn').onclick;
         document.getElementById('sell-house-btn').onclick = document.getElementById('sell-house-btn').onclick;
     }
     
     // 綁定事件 (包含在 showPropertyManagementModal 首次呼叫時，和之後的重新渲染)
     bindManagementEvents(currentPlayer, currentSquare);
     
}

// **NEW: 重新導出給按鈕調用 (處理重新整理後點擊)**
window.showPropertyBuyModalWrapper = () => {
    if (gameState.pendingAction.type === 'BUY_PROPERTY') {
        const currentPlayer = gameState.players[gameState.turn];
        const currentSquare = gameState.board[gameState.pendingAction.squareIndex];
        showPropertyBuyModal(currentPlayer, currentSquare);
    } else {
        addLog('錯誤: 當前不是購買地產的時機。', 'error');
    }
};

// **NEW: 重新導出給按鈕調用 (處理重新整理後點擊)**
window.showPropertyManagementModalWrapper = () => {
    if (gameState.pendingAction.type === 'PROPERTY_MANAGEMENT') {
        const currentPlayer = gameState.players[gameState.turn];
        const currentSquare = gameState.board[gameState.pendingAction.squareIndex];
        showPropertyManagementModal(currentPlayer, currentSquare);
    } else {
        addLog('錯誤: 當前不是地產管理的時機。', 'error');
    }
};

window.showTrapTargetModalWrapper = () => {
    if (gameState.pendingAction.type === 'USE_TRAP_CARD' && gameState.players[gameState.turn].trapCard) {
        const currentPlayer = gameState.players[gameState.turn];
        showTrapTargetModal(currentPlayer, currentPlayer.trapCard);
    } else {
        addLog('錯誤: 當前沒有陷害卡可使用或不是使用陷害卡的時機。', 'error');
    }
};


// --- 核心卡片處理邏輯更新 ---

// 舊的 handleCardEffect 被拆分為 applyCardEffect + showCardModal

function showCardModal(player, message, type, isNonBlocking) {
    const cardModal = document.getElementById('card-modal');
    const cardContent = document.getElementById('card-content');
    const cardTitle = document.getElementById('card-modal-title');
    const cardMessage = document.getElementById('card-modal-message');
    const cardConfirmBtn = document.getElementById('card-modal-confirm-btn');

    cardContent.className = `w-full max-w-sm rounded-xl shadow-2xl p-6 text-center ${type === 'CHANCE' ? 'card-chance' : 'card-fate'}`;
    cardTitle.textContent = `${type === 'CHANCE' ? '機會卡' : '命運卡'} [${player.name} 操作]`; 
    cardMessage.innerHTML = message;
    
    // 只有當前玩家才能確認 (考慮熱機模式)
    const isGameMasterDevice = gameState?.players[0]?.currentUserId === userId;
    const isHotSwapMode = gameState?.settings?.hotSwapMode === true;
    const isMyTurn = (isHotSwapMode && isGameMasterDevice) || (player.currentUserId === userId); 

    if (!isMyTurn) {
        cardModal.classList.add('hidden');
        cardModal.classList.remove('flex');
        return;
    }
    
    cardModal.classList.remove('hidden');
    cardModal.classList.add('flex');
    
    // ** 修正：對於非陷害卡 (isNonBlocking=true)，只需確認並結束回合 **
    cardConfirmBtn.onclick = () => {
        cardModal.classList.add('hidden');
        cardModal.classList.remove('flex');
        
        if (isNonBlocking) {
            // ** NEW: 避免重複執行 updateGameState，只需呼叫 endTurn **
            // 狀態更新和日誌寫入已在 applyCardEffect -> handleLandingAction 中完成
            setTimeout(async () => {
                // 確保 pendingAction 被清除
                const nextState = { ...gameState, pendingAction: { type: 'none', squareIndex: null, card: null } };
                await setDoc(gameRef, nextState);
                await endTurn();
            }, 50);
        } else {
            // 陷害卡/特殊卡片（理論上這裡不會被調用，因為陷害卡有自己的 Modal）
            // 但作為安全機制，也進行狀態清除和結束回合
            saveCurrentPlayerState(player); 
            const nextState = { ...gameState, status: 'ROLLED', pendingAction: { type: 'none', squareIndex: null, card: null } };
            setTimeout(async () => {
                await updateGameState(nextState, `卡片效果生效並確認。`); 
                await endTurn();
            }, 50);
        }
    };
}

function handleCasinoLogic(currentPlayer, betAmount) {
    const symbols = ['🍒', '🍋', '🔔', 'BAR', '7️⃣'];
    // 修正：確保結果是 5 個
    const results = Array(5).fill().map(() => symbols[Math.floor(Math.random() * symbols.length)]);

    currentPlayer.money -= betAmount;
    let winnings = 0;
    let netGain = -betAmount;
    let message = '';
    let multiplier = 0;

    const resStr = results.join(' ');
    // 檢查是否所有結果都相同
    const allSame = results.every(val => val === results[0]);
    // 檢查是否有三個相同
    const counts = results.reduce((acc, val) => { acc[val] = (acc[val] || 0) + 1; return acc; }, {});
    const hasThreeSame = Object.values(counts).some(count => count >= 3);
    // 檢查是否有兩個 BAR
    const barCount = counts['BAR'] || 0;
    
    
    if (allSame) {
        // 修正: 5個相同獎勵更高 (因為現在是 5 個輪盤)
        if (results[0] === '7️⃣') {
            multiplier = 10;
            message = `🎰 ${resStr} 🎰 <br/> **超級大獎!** 五個 777，${multiplier} 倍獎金!`;
        } else if (results[0] === 'BAR') {
            multiplier = 7;
            message = `🎰 ${resStr} 🎰 <br/> **大獎!** 五個 BAR，${multiplier} 倍獎金!`;
        } else {
            multiplier = 5;
            message = `🎰 ${resStr} 🎰 <br/> 恭喜! 五個相同，${multiplier} 倍獎金!`;
        }
    } else if (hasThreeSame) {
        multiplier = 2;
        message = `🎰 ${resStr} 🎰 <br/> 恭喜! 三個相同，${multiplier} 倍獎金!`;
    } else if (barCount >= 2) {
        multiplier = 1.5;
        message = `🎰 ${resStr} 🎰 <br/> 恭喜! 兩個 BAR，${multiplier} 倍獎金!`;
    } else {
        message = `🎰 ${resStr} 🎰 <br/> 很遺憾，未中獎。`;
    }
    
    winnings = betAmount * multiplier;
    netGain = winnings - betAmount;
    currentPlayer.money += winnings;

    return { winnings, message, resStr, netGain, betAmount, results };
}

function showCasinoModal(currentPlayer) {
    
    // 檢查是否是自己的回合 (考慮熱機模式)
    const isGameMasterDevice = gameState.players[0] && gameState.players[0].currentUserId === userId;
    const isHotSwapMode = gameState.settings?.hotSwapMode === true;
    const isMyTurn = (isHotSwapMode && isGameMasterDevice) || (currentPlayer.currentUserId === userId); 

    if (!isMyTurn) {
        addLog(`錯誤：現在是 ${currentPlayer.name} 的回合，您無法執行動作！`, 'error');
        return;
    }
    
    let totalNetGain = 0; 
    let currentBet = 0; 
    const spinSymbols = ['🍒', '🍋', '🔔', 'BAR', '7️⃣', '💰', '💎'];
    let spinIntervals = [];
    const minBet = 50;

    const contentHtml = `<div id="casino-display" class="p-4 bg-gray-50 rounded-lg text-center">
                             <p class="text-sm text-gray-500 mb-2">請選擇您的投注籌碼 (最低 $${minBet})：</p>
                             
                             <div id="chip-buttons" class="flex justify-center space-x-2 mb-4">
                                ${[50, 100, 500, 1000].map(chip => `
                                    <button data-chip="${chip}" 
                                        class="chip-btn w-12 h-12 rounded-full font-bold text-white shadow-xl hover:scale-105 transition duration-150 transform active:shadow-inner"
                                        style="background-color: ${chip === 50 ? '#8b5cf6' : chip === 100 ? '#3b82f6' : chip === 500 ? '#ef4444' : '#10b981'};">
                                    $${chip}
                                    </button>
                                `).join('')}
                             </div>

                             <div class="flex justify-center items-center space-x-4 mb-4">
                                 <div class="p-3 border-2 border-dashed border-gray-400 rounded-lg shadow-inner bg-white">
                                    <p class="text-xs text-gray-500">當前投注</p>
                                    <p id="current-bet" class="text-2xl font-extrabold text-red-600">$0</p>
                                 </div>
                                 <button id="clear-bet-btn" class="py-2 px-4 bg-gray-400 text-white rounded-lg hover:bg-gray-500 transition duration-150">
                                    退幣 (C)
                                 </button>
                             </div>

                             <p class="text-sm text-gray-500 mb-2">當前現金: <span id="current-cash" class="font-bold text-gray-800">$${currentPlayer.money.toLocaleString()}</span></p>
                             
                             <div id="casino-slots" class="flex justify-center space-x-2 text-3xl my-4 h-16 items-center">
    <span id="slot-1" class="font-extrabold text-gray-700 slot-spinning">?</span>
    <span id="slot-2" class="font-extrabold text-gray-700 slot-spinning">?</span>
    <span id="slot-3" class="font-extrabold text-gray-700 slot-spinning">?</span>
    <span id="slot-4" class="font-extrabold text-gray-700 slot-spinning">?</span>
    <span id="slot-5" class="font-extrabold text-gray-700 slot-spinning">?</span>
</div>

                             <div id="game-result" class="font-extrabold text-lg my-4 text-gray-700">獎勵倍率: 5x 相同 (5x), 3x 相同 (2x), 2x BAR (1.5x)</div>
                             <p class="text-sm text-gray-500">本次服務總淨收益: <span id="total-gain" class="font-bold text-gray-800">$0</span></p>
                        </div>`;

    showModal(
        `[${currentPlayer.name}] Casino - 吃角子老虎機`, 
        `<p class="text-lg">最低投注 $${minBet}，點擊籌碼按鈕進行累積。</p>`,
        () => {}, 
        contentHtml,
        '開始玩' 
    );

    const modalConfirmBtn = document.getElementById('modal-confirm-btn');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const currentCashSpan = document.getElementById('current-cash');
    const totalGainSpan = document.getElementById('total-gain');
    const gameResultDiv = document.getElementById('game-result');
    const currentBetSpan = document.getElementById('current-bet'); 
    const slotElements = [
    document.getElementById('slot-1'),
    document.getElementById('slot-2'),
    document.getElementById('slot-3'),
    document.getElementById('slot-4'),
    document.getElementById('slot-5')
];
    
    function startSpin() {
        spinIntervals.forEach(clearInterval);
        spinIntervals = [];

        slotElements.forEach((slot, index) => {
            slot.classList.add('slot-spinning');
            let interval = setInterval(() => {
                slot.textContent = spinSymbols[Math.floor(Math.random() * spinSymbols.length)];
            }, 80 + index * 50);
            spinIntervals.push(interval);
        });
    }

    function stopSpin(finalResults) {
        spinIntervals.forEach(clearInterval);
        slotElements.forEach((slot, index) => {
            slot.classList.remove('slot-spinning');
            slot.textContent = finalResults[index];
        });
    }

    modalCancelBtn.textContent = '離開賭場'; 
    modalCancelBtn.classList.remove('hidden');
    modalConfirmBtn.textContent = '開始玩'; 
    modalConfirmBtn.disabled = true; 

    document.querySelectorAll('.chip-btn').forEach(button => {
        button.onclick = () => {
            const chipValue = parseInt(button.dataset.chip);
            if (currentPlayer.money >= currentBet + chipValue) {
                currentBet += chipValue;
                currentBetSpan.textContent = `$${currentBet.toLocaleString()}`;
                modalConfirmBtn.disabled = currentBet < minBet;
                gameResultDiv.innerHTML = `<span class="text-gray-500">已累積 $${currentBet.toLocaleString()} 籌碼。</span>`;
            } else {
                gameResultDiv.innerHTML = `<span class="text-red-600">籌碼不足，無法加註 $${chipValue.toLocaleString()}！</span>`;
            }
        };
    });
    
    document.getElementById('clear-bet-btn').onclick = () => {
         currentBet = 0;
         currentBetSpan.textContent = `$0`;
         modalConfirmBtn.disabled = true;
         gameResultDiv.innerHTML = '獎勵倍率: 5x 相同 (5x), 3x 相同 (2x), 2x BAR (1.5x)';
    };


    // ** Bug 2 修正: 確保取消和確認動作都是在 Modal 關閉後異步執行 endTurn **
    const handleCasinoExit = () => {
        spinIntervals.forEach(clearInterval);
        currentPlayer.money += currentBet; // 退還未投注籌碼

        const logMsg = `玩 Casino 結束回合，總淨收益 $${totalNetGain.toLocaleString()}。`;

        saveCurrentPlayerState(currentPlayer);

        document.getElementById('modal').classList.add('hidden');
        document.getElementById('modal').classList.remove('flex');

        setTimeout(async () => {
            const nextState = {
                ...gameState,
                status: 'ROLLED',
                pendingAction: { type: 'none', squareIndex: null, card: null } // 關鍵清除
            };
            await updateGameState(nextState, logMsg);
            await endTurn();
        }, 50);
    };

    modalCancelBtn.onclick = handleCasinoExit;
    document.getElementById('modal-top-close-btn').onclick = handleCasinoExit; // **點擊 X 也視為離開**

    modalConfirmBtn.onclick = async () => { 
        const betAmount = currentBet; 
        currentBet = 0; 

        if (modalConfirmBtn.disabled || betAmount < minBet) return; 

        if (currentPlayer.money < betAmount) {
            gameResultDiv.innerHTML = `<span class="text-red-600 text-xl">現金不足 $${betAmount.toLocaleString()}! 請離開賭場。</span>`;
            modalConfirmBtn.disabled = true;
            return;
        }
        
        currentBetSpan.textContent = `$0`; 
        modalConfirmBtn.disabled = true; 
        startSpin();

        await new Promise(resolve => setTimeout(resolve, 1500)); 

        const { message, netGain, results } = handleCasinoLogic(currentPlayer, betAmount);
        totalNetGain += netGain;

        stopSpin(results);
        
        saveCurrentPlayerState(currentPlayer);
        await updateGameState(gameState, `${currentPlayer.name} 投注 $${betAmount.toLocaleString()}，淨收益 $${netGain.toLocaleString()}。`);

        gameResultDiv.innerHTML = `<p class="text-base">${message}</p>`;
        currentCashSpan.textContent = `$${currentPlayer.money.toLocaleString()}`;
        
        if (totalNetGain >= 0) {
            totalGainSpan.className = 'font-bold text-green-600';
        } else {
            totalGainSpan.className = 'font-bold text-red-600';
        }
        totalGainSpan.textContent = `$${totalNetGain.toLocaleString()}`;

        if (currentPlayer.money >= minBet) { 
            modalConfirmBtn.disabled = true; 
            gameResultDiv.innerHTML += `<p class="text-base text-gray-500 mt-2">請點擊籌碼累積下次投注。</p>`;
        } else {
            modalConfirmBtn.disabled = true;
            modalCancelBtn.classList.remove('hidden');
            gameResultDiv.innerHTML += `<p class="text-base text-red-500 mt-2">現金不足，請點擊「離開賭場」。</p>`;
        }
    };
    
    modalConfirmBtn.classList.remove('hidden');
    // ** Bug 1 修正: 確保頂部關閉按鈕執行退出邏輯**
    document.getElementById('modal-top-close-btn').onclick = handleCasinoExit;
}

function showBankModal(currentPlayer) {
    
    // 檢查是否是自己的回合 (考慮熱機模式)
    const isGameMasterDevice = gameState.players[0] && gameState.players[0].currentUserId === userId;
    const isHotSwapMode = gameState.settings?.hotSwapMode === true;
    const isMyTurn = (isHotSwapMode && isGameMasterDevice) || (currentPlayer.currentUserId === userId); 
    
    if (!isMyTurn) {
        addLog(`錯誤：現在是 ${currentPlayer.name} 的回合，您無法執行動作！`, 'error');
        return;
    }
    
    const interestRate = gameState.settings.interestRate;
    
    // --- NEW: 獲取股票列表並新增診斷資訊 ---
    // 這裡直接使用 currentStocks，因為 onSnapshot 邏輯已確保其與 stocksConfig 同步
    const availableStocks = gameState.currentStocks;
    const stockCountDiagnostic = availableStocks.length;

    const stockTradingHtml = availableStocks.map(stock => {
         // 必須從 settings.stocksConfig 中獲取 volatility 才能在儲存時使用
         const stockConfig = gameState.settings.stocksConfig.find(s => s.symbol === stock.symbol);
         const volatilityDisplay = stockConfig ? stockConfig.volatility : DEFAULT_VOLATILITY;
         
         return `
                      <div class="flex items-center space-x-2 mb-2 p-1 border-b border-gray-200">
                          <p class="font-semibold text-sm w-16">${stock.symbol}</p>
                          <p class="text-xs text-gray-700 w-20">買: $${stock.price.toLocaleString()}</p>
                          <p class="text-xs text-gray-700 w-20">賣: $${stock.sellPrice.toLocaleString()}</p>
                          <input type="number" id="stock-amount-${stock.symbol}" value="1" min="1" step="1" class="w-12 p-1 border rounded text-center text-xs"/>
                          <button data-symbol="${stock.symbol}" data-action="buy" class="stock-action-btn py-1 px-2 bg-emerald-500 text-white rounded text-xs hover:bg-emerald-600">買入</button>
                          <button data-symbol="${stock.symbol}" data-action="sell" class="stock-action-btn py-1 px-2 bg-red-500 text-white rounded text-xs hover:bg-red-600">賣出</button>
                          <p class="text-xs text-gray-500">持股: <span id="player-stocks-${stock.symbol}" class="font-bold text-gray-800">${currentPlayer.stocks[stock.symbol] || 0}</span></p>
                      </div>
                    `;
    }).join('');

    const contentHtml = `
         <div class="bg-gray-100 p-4 rounded-lg text-sm text-gray-700 mb-4">
              <p class="font-semibold mb-2 text-base text-gray-800">當前資產 (定存利率: ${(interestRate * 100).toFixed(2)}%)</p>
              <p>現金 (可交易): <span id="bank-cash" class="font-bold text-gray-800">$${currentPlayer.money.toLocaleString()}</span></p>
              <p>定存 (賺利息): <span id="bank-deposit-display" class="font-bold text-gray-800">$${currentPlayer.bank.toLocaleString()}</span></p>
         </div>

         <div class="mb-4 border-b pb-4">
              <p class="font-bold mb-2">定存服務</p>
              <input type="number" id="bank-amount" value="1000" min="100" step="100" class="w-1/3 p-2 border rounded-lg text-center mr-2 focus:outline-none focus:ring-2 focus:ring-blue-500"/>
              <button id="deposit-btn" class="py-2 px-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition duration-150">存款</button>
              <button id="withdraw-btn" class="py-2 px-3 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition duration-150">提款</button>
              <p id="bank-msg" class="text-xs text-red-500 mt-1"></p>
         </div>

         <div class="mb-4">
              <p class="font-bold mb-2">股票交易 (價格已更新)</p>
              <p class="text-sm font-semibold text-indigo-600 mb-2">📊 當前顯示的股票總數: ${stockCountDiagnostic} 支</p>
              <p id="stock-msg" class="text-xs text-red-500 mt-1"></p>
              <div id="stock-trading-list">
                    ${stockTradingHtml}
              </div>
         </div>
     `;
    showModal(
        `[${currentPlayer.name}] 銀行服務`, 
        '歡迎使用銀行服務，這裡也提供股票交易。',
        // **將 Action 改為同步函式，以避免 Bug 2 的問題**
        () => { 
            // Modal Confirm Action: 設置狀態為 ROLLED，讓玩家可以結束回合
            // 使用 setTimeout 確保 Modal 關閉後再執行異步操作
            setTimeout(async () => {
                await updateGameState({ ...gameState, status: 'ROLLED', pendingAction: { type: 'none', squareIndex: null, card: null } }, `${currentPlayer.name} 完成銀行操作。`); 
                await endTurn(); 
            }, 50);
        },
        contentHtml,
        '完成服務'
    );

    document.getElementById('modal-confirm-btn').textContent = '完成服務';
    // document.getElementById('modal-cancel-btn').classList.add('hidden'); // 統一在 showModal 內處理
    document.getElementById('modal-confirm-btn').classList.remove('hidden');

    const bankCash = document.getElementById('bank-cash');
    const bankDeposit = document.getElementById('bank-deposit-display'); // FIX: Corrected ID lookup
    const bankMsg = document.getElementById('bank-msg');
    const stockMsg = document.getElementById('stock-msg');
    const bankAmountInput = document.getElementById('bank-amount');

    document.getElementById('deposit-btn').onclick = async () => {
        const amount = parseInt(bankAmountInput.value) || 0;
        bankMsg.textContent = '';
        if (amount <= 0 || currentPlayer.money < amount) {
            bankMsg.textContent = '錯誤：金額必須大於 0 且不超過現金！';
            return;
        }
        currentPlayer.money -= amount;
        currentPlayer.bank += amount;
        saveCurrentPlayerState(currentPlayer);
        await updateGameState(gameState, `${currentPlayer.name} 存款 $${amount.toLocaleString()} 到定存。`);
        bankCash.textContent = `$${currentPlayer.money.toLocaleString()}`;
        bankDeposit.textContent = `$${currentPlayer.bank.toLocaleString()}`;
    };

    document.getElementById('withdraw-btn').onclick = async () => {
        const amount = parseInt(bankAmountInput.value) || 0;
        bankMsg.textContent = '';
        if (amount <= 0 || currentPlayer.bank < amount) {
            bankMsg.textContent = '錯誤：金額必須大於 0 且不超過存款！';
            return;
        }
        currentPlayer.money += amount;
        currentPlayer.bank -= amount;
        saveCurrentPlayerState(currentPlayer);
        await updateGameState(gameState, `${currentPlayer.name} 從定存提款 $${amount.toLocaleString()}。`);
        bankCash.textContent = `$${currentPlayer.money.toLocaleString()}`;
        bankDeposit.textContent = `$${currentPlayer.bank.toLocaleString()}`; 
    };

    document.querySelectorAll('#stock-trading-list .stock-action-btn').forEach(button => {
        button.onclick = async () => {
            const symbol = button.dataset.symbol;
            const action = button.dataset.action;
            // 使用最新的 currentStocks 數據
            const stock = gameState.currentStocks.find(s => s.symbol === symbol); 
            const quantityInput = document.getElementById(`stock-amount-${symbol}`);
            const quantity = parseInt(quantityInput.value) || 0;
            const playerStockSpan = document.getElementById(`player-stocks-${symbol}`);
            stockMsg.textContent = '';

            if (quantity <= 0) {
                stockMsg.textContent = '錯誤：數量必須大於 0！';
                return;
            }
            
            if (!stock) {
                 stockMsg.textContent = '錯誤：股票資訊不存在。';
                 return;
            }
            
            // NEW FIX: 確保持股量已初始化 (解決新增股票後無法購買的問題)
            if (typeof currentPlayer.stocks[symbol] === 'undefined') {
                 currentPlayer.stocks[symbol] = 0;
            }

            if (action === 'buy') {
                const cost = quantity * stock.price;
                if (currentPlayer.money < cost) {
                    stockMsg.textContent = `錯誤：現金不足以支付 $${cost.toLocaleString()} (買入價 $${stock.price.toLocaleString()})。`;
                    return;
                }
                currentPlayer.money -= cost;
                // 確保 currentPlayer.stocks 中有該股票的條目
                currentPlayer.stocks = { ...currentPlayer.stocks, [symbol]: (currentPlayer.stocks[symbol] || 0) + quantity }; 
                saveCurrentPlayerState(currentPlayer);
                await updateGameState(gameState, `${currentPlayer.name} 買入 ${quantity} 股 ${symbol}，花費 $${cost.toLocaleString()}。`);

            } else if (action === 'sell') {
                const revenue = quantity * stock.sellPrice;
                if ((currentPlayer.stocks[symbol] || 0) < quantity) {
                    stockMsg.textContent = `錯誤：持股數量不足 (持有 ${currentPlayer.stocks[symbol] || 0})！`;
                    return;
                }
                currentPlayer.money += revenue;
                currentPlayer.stocks = { ...currentPlayer.stocks, [symbol]: (currentPlayer.stocks[symbol] || 0) - quantity };
                saveCurrentPlayerState(currentPlayer);
                await updateGameState(gameState, `${currentPlayer.name} 賣出 ${quantity} 股 ${symbol}，獲得 $${revenue.toLocaleString()}。`);
            }

            bankCash.textContent = `$${currentPlayer.money.toLocaleString()}`;
            playerStockSpan.textContent = currentPlayer.stocks[symbol];
        };
    });
    
    // ** 修復：點擊 X 或離開銀行時，強制結束銀行動作，讓回合可以繼續 **
    const handleBankExit = async () => {
        // 【新增】防止重複觸發並鎖定自動恢復
        if (isProcessingAction) return;
        isProcessingAction = true;

        document.getElementById('modal').classList.add('hidden');
        document.getElementById('modal').classList.remove('flex');

        // 關鍵：清除 pendingAction
        const nextState = {
            ...gameState,
            status: 'ROLLED',
            pendingAction: { type: 'none', squareIndex: null, card: null }
        };

        await updateGameState(nextState, `${currentPlayer.name} 離開銀行服務（未完成操作）。`);
        await endTurn();
        
        // 【新增】安全解鎖 (雖然通常頁面狀態變更後不需要，但以防萬一)
        setTimeout(() => { isProcessingAction = false; }, 2000);
    };

    // 頂部 X 按鈕
    document.getElementById('modal-top-close-btn').onclick = handleBankExit;

    // 如果有取消按鈕（雖然目前隱藏），也綁定同樣邏輯
    const cancelBtn = document.getElementById('modal-cancel-btn');
    if (!cancelBtn.classList.contains('hidden')) {
        cancelBtn.onclick = handleBankExit;
    }

    // 「完成服務」確認按鈕（原本就結束回合，保持不變）
    document.getElementById('modal-confirm-btn').onclick = async () => {
        // 【新增】鎖定自動恢復
        if (isProcessingAction) return;
        isProcessingAction = true;

        document.getElementById('modal').classList.add('hidden');
        document.getElementById('modal').classList.remove('flex');

        await updateGameState({ ...gameState, status: 'ROLLED', pendingAction: { type: 'none', squareIndex: null, card: null } }, `${currentPlayer.name} 完成銀行操作。`);
        await endTurn();

        // 【新增】安全解鎖
        setTimeout(() => { isProcessingAction = false; }, 2000);
    };
}

function showSettingsModal() {
    // NEW: 只有 P0 管理員可以進入設定
    if (gameState.players[0].currentUserId !== userId) {
        addLog('錯誤：只有 P0 玩家（管理員）可以修改設定。', 'error');
        return;
    }

    const currentSettings = gameState.settings;
    let currentStocks = [...currentSettings.stocksConfig]; // 使用 let 允許在本地修改

    const renderStockList = () => {
        const listContainer = document.getElementById('stock-list-container');
        if (!listContainer) return;

        listContainer.innerHTML = currentStocks.map(stock => {
            // 嘗試從動態價格中獲取當前市價
            const marketPrice = gameState.currentStocks.find(s => s.symbol === stock.symbol)?.price || 'N/A';
            
            return `
                     <div class="flex items-center space-x-2 border-b py-2">
                         <p class="font-bold text-gray-700 w-1/3">${stock.name} (${stock.symbol})</p>
                         <p class="text-sm text-gray-600 w-1/4">波動度: ${stock.volatility}</p>
                         <p class="text-sm text-gray-600 w-1/4">市價: $${marketPrice.toLocaleString()}</p>
                         <button data-symbol="${stock.symbol}" data-action="remove" class="remove-stock-btn py-1 px-2 bg-red-500 text-white rounded text-xs hover:bg-red-600 transition duration-150">刪除</button>
                     </div>
                   `;
        }).join('');

        document.querySelectorAll('.remove-stock-btn').forEach(btn => {
            btn.onclick = (e) => {
                const symbolToRemove = e.target.dataset.symbol;
                currentStocks = currentStocks.filter(s => s.symbol !== symbolToRemove);
                renderStockList();
            };
        });
    };


    const contentHtml = `
         <div class="space-y-4">
            
             <div class="border-b pb-3">
                  <label for="setting-initial-money" class="font-bold text-gray-700 block mb-2">預設初始金錢 (用於重啟/玩家啟用):</label>
                  <input type="number" id="setting-initial-money" value="${currentSettings.initialMoney}" min="1000" step="500" class="w-full p-2 border rounded-lg text-center font-bold text-gray-800"/>
                  <p class="text-xs text-gray-500 mt-1">當前預設值: $${currentSettings.initialMoney.toLocaleString()}</p>
             </div>
             
             <div class="border-b pb-3">
                  <label for="setting-interest-rate" class="font-bold text-gray-700 block mb-2">定存利率 (每回合，例如 0.01 = 1%):</label>
                  <input type="number" id="setting-interest-rate" value="${currentSettings.interestRate}" min="0.001" step="0.005" class="w-full p-2 border rounded-lg text-center font-bold text-gray-800"/>
                  <p class="text-xs text-gray-500 mt-1">當前: ${(currentSettings.interestRate * 100).toFixed(2)}%</p>
             </div>

             <div class="border-b pb-3">
                  <label for="setting-hot-swap-mode" class="font-bold text-gray-700 block mb-2">
                      **熱機模式** (單人多角操作)
                  </label>
                  <div class="flex items-center justify-between">
                      <p class="text-xs text-gray-500 w-3/4">啟用後，只有控制 P0 的設備可以控制所有啟用玩家的回合。</p>
                      <label class="relative inline-flex items-center cursor-pointer">
                           <input type="checkbox" id="setting-hot-swap-mode" ${currentSettings.hotSwapMode ? 'checked' : ''} value="" class="sr-only peer">
                           <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-600"></div>
                      </label>
                  </div>
             </div>

             <div class="border-b pb-3">
                  <label for="setting-debug-mode" class="font-bold text-gray-700 block mb-2">
                      **擲骰偵錯模式** (強制輸入步數)
                  </label>
                  <div class="flex items-center justify-between">
                      <p class="text-xs text-red-500 w-3/4">啟用後，擲骰按鈕旁會出現步數輸入框 (僅 P0 裝置可見/使用)。</p>
                      <label class="relative inline-flex items-center cursor-pointer">
                           <input type="checkbox" id="setting-debug-mode" ${currentSettings.debugMode ? 'checked' : ''} value="" class="sr-only peer">
                           <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-600"></div>
                      </label>
                  </div>
             </div>
             <div class="border-b pb-3">
                  <p class="font-bold text-gray-700 mb-2">加入遊戲審核狀態:</p>
                  <p class="text-sm text-indigo-600 font-semibold">✅ 已強制啟用 (所有新玩家加入遊戲前都需要 P0 管理員在「玩家管理」中批准)</p>
             </div>

             <div class="mb-4">
                  <p class="font-bold mb-2 text-gray-700">股票管理 (${currentStocks.length} 支)</p>
                  <div id="stock-list-container" class="max-h-40 overflow-y-auto mb-4">
                      </div>
                  
                  <div class="p-3 bg-gray-50 rounded-lg space-y-2">
                      <p class="font-semibold text-sm">新增股票 (波動度預設為 ${DEFAULT_VOLATILITY})</p>
                      <input type="text" id="new-stock-symbol" placeholder="代號 (如: NEW)" maxlength="4" class="w-1/3 p-2 border rounded text-xs" />
                      <input type="text" id="new-stock-name" placeholder="名稱 (如: 新公司)" class="w-1/3 p-2 border rounded text-xs" />
                      <input type="number" id="new-stock-price" placeholder="初始買價" value="400" min="100" class="w-1/3 p-2 border rounded text-xs" />
                      <button id="add-stock-btn" class="w-full py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition duration-150">新增股票</button>
                      <p id="stock-admin-msg" class="text-xs text-red-500 mt-1"></p>
                  </div>
             </div>

             <div class="pt-4 border-t border-red-300">
                  <p class="font-bold mb-2 text-red-700">危險區域：遊戲管理</p>
                  <button id="restart-game-btn" class="w-full py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition duration-150 font-bold">
                      💥 重新啟動遊戲 (重設進度)
                  </button>
                  <p class="text-xs text-gray-500 mt-1">此操作將清除所有玩家進度，請謹慎操作。</p>
                  <p class="text-xs text-red-500 mt-1 font-bold">⚠️ 注意：點擊此按鈕將套用新的棋盤結構。</p>
             </div>
         </div>
     `;
    
    showModal(
        `[管理員] 設定`, 
        '定存利率、預設初始金錢、熱機模式及股票名單變更將於儲存後生效。',
        async () => {
            const newInterestRate = parseFloat(document.getElementById('setting-interest-rate').value);
            const newInitialMoney = parseInt(document.getElementById('setting-initial-money').value);
            const newHotSwapMode = document.getElementById('setting-hot-swap-mode').checked; 
            const newDebugMode = document.getElementById('setting-debug-mode').checked; // NEW: Debug 模式

            
            gameState.settings.interestRate = newInterestRate;
            gameState.settings.stocksConfig = currentStocks; 
            gameState.settings.initialMoney = newInitialMoney;
            gameState.settings.hotSwapMode = newHotSwapMode; 
            gameState.settings.debugMode = newDebugMode; // NEW: Debug 模式
            
            const updatedStocks = [];
            currentStocks.forEach(newStockConfig => {
                 const existingStock = gameState.currentStocks.find(s => s.symbol === newStockConfig.symbol);
                 if (existingStock) {
                     // 保留現有股票的動態價格
                     updatedStocks.push({ ...existingStock, volatility: newStockConfig.volatility });
                 } else {
                     // 新增股票，使用設定的初始價並計算賣價 (FIX: 確保使用 newStockConfig.volatility)
                     const initialPrice = newStockConfig.price; 
                     updatedStocks.push({
                         name: newStockConfig.name,
                         symbol: newStockConfig.symbol,
                         price: initialPrice,
                         sellPrice: Math.floor(initialPrice * 0.8),
                         volatility: newStockConfig.volatility, 
                     });
                 }
            });

            // 同步玩家的持股結構，確保新股票有初始的 0 股記錄
            gameState.players.forEach(player => {
                 const updatedPlayerStocks = {};
                 // 遍歷最新的股票列表 (currentStocks)
                 currentStocks.forEach(stock => {
                     updatedPlayerStocks[stock.symbol] = player.stocks[stock.symbol] || 0;
                 });
                 player.stocks = updatedPlayerStocks;
                 saveCurrentPlayerState(player); 
            });

            gameState.currentStocks = updatedStocks;
            
            await updateGameState(gameState, `管理員更新了遊戲設定 (利率: ${(newInterestRate * 100).toFixed(2)}%, 熱機模式: ${newHotSwapMode ? '啟用' : '禁用'})。`);
        },
        contentHtml,
        '儲存設定'
    );
    
    renderStockList();

    document.getElementById('add-stock-btn').onclick = () => {
        const symbolInput = document.getElementById('new-stock-symbol');
        const nameInput = document.getElementById('new-stock-name');
        const priceInput = document.getElementById('new-stock-price');
        const msg = document.getElementById('stock-admin-msg');

        const symbol = symbolInput.value.toUpperCase().trim();
        const name = nameInput.value.trim();
        const price = parseInt(priceInput.value);

        if (symbol.length < 3 || symbol.length > 4 || name === '' || price < 100 || isNaN(price)) {
            msg.textContent = '錯誤：代號需 3-4 字元，名稱不可為空，初始價需 > 100。';
            return;
        }
        if (currentStocks.some(s => s.symbol === symbol)) {
            msg.textContent = `錯誤：股票代號 ${symbol} 已存在。`;
            return;
        }

        // FIX: 新增股票時確保 volatility 有值
        currentStocks.push({ 
            name: name, 
            symbol: symbol, 
            price: price, 
            sellPrice: Math.floor(price * 0.8), 
            volatility: DEFAULT_VOLATILITY // 預設 50
        });

        symbolInput.value = '';
        nameInput.value = '';
        priceInput.value = '400';
        msg.textContent = `已新增 ${symbol}，請點擊「儲存設定」以生效。`;
        renderStockList(); 
    };
    
    document.getElementById('restart-game-btn').onclick = () => {
        showModal(
            '⚠️ 確認重新啟動遊戲',
            '<p class="text-red-600 font-bold">您確定要重設所有玩家的進度和資產嗎？此操作無法撤銷！</p><p class="mt-2 text-sm">遊戲將回到初始狀態。</p>',
            restartGame, 
            null,
            '確認重啟遊戲'
        );
        // 確保重啟彈窗可以取消
        document.getElementById('modal-cancel-btn').classList.remove('hidden'); 
    };
    
    document.getElementById('modal-cancel-btn').classList.remove('hidden');
}

// ** NEW FIX: 暴露給全局作用域 **
window.showPlayerAdminModal = showPlayerAdminModal;
// ** END NEW FIX **

/**
 * 處理玩家加入請求的批准或拒絕。
 * 只有 P0 控制者可以調用。
 */
async function handleJoinRequest(requestingUserId, action) {
    if (!gameState) return;

    const gameMaster = gameState.players[0];
    const isGameMasterDevice = gameMaster && gameMaster.currentUserId === userId;

    if (!isGameMasterDevice) {
        addLog('錯誤：只有遊戲管理員 (P0 控制者) 可以批准加入請求。', 'error');
        return;
    }

    const playerId = gameState.pendingJoinRequests[requestingUserId];
    const playerIndex = gameState.players.findIndex(p => p.id === playerId);
    const playerName = gameState.players[playerIndex]?.name || `角色 ID: ${playerId}`;
    let logMsg = '';

    if (action === 'approve' && playerIndex !== -1) {
        // 1. 綁定玩家角色
        gameState.players[playerIndex].currentUserId = requestingUserId;
        
        // 2. 清除其他可能錯誤殘留的 ID 
        gameState.players.forEach((p, index) => {
             if (index !== playerIndex && p.currentUserId === requestingUserId) {
                 // 將該用戶從其他角色解除綁定 (如果他不小心認領了多個)
                 p.currentUserId = null;
             }
        });
        // 確保只綁定給被批准的角色
        gameState.players[playerIndex].currentUserId = requestingUserId; 

        logMsg = `管理員批准了用戶 ${requestingUserId.substring(0, 8)}... 加入，控制 ${playerName}。`;
    } else if (action === 'reject') {
        // 不做任何綁定，只記錄日誌
        logMsg = `管理員拒絕了用戶 ${requestingUserId.substring(0, 8)}... 加入請求 (角色: ${playerName})。`;
    } else {
        addLog('錯誤：無效的操作或玩家角色不存在。', 'error');
        return;
    }

    // 移除請求
    delete gameState.pendingJoinRequests[requestingUserId];
    
    // 儲存狀態
    await updateGameState(gameState, logMsg);
    
    // 由於 onSnapshot 會觸發 showPlayerAdminModal 重新渲染，這裡不需要手動呼叫
    // showPlayerAdminModal(); 
}

/**
 * 踢出玩家，解除綁定 (功能 4)
 */
async function kickPlayer(playerIdToKick) {
     if (!gameState) return;

     const gameMaster = gameState.players[0];
     if (gameMaster.currentUserId !== userId) {
         addLog('錯誤：只有遊戲管理員 (P0 控制者) 可以踢人。', 'error');
         return;
     }
     
     // P0 不能踢自己
     if (playerIdToKick === 'p0') {
         addLog('錯誤：管理員無法將自己從控制權中移除。', 'error');
         return;
     }

     const playerIndex = gameState.players.findIndex(p => p.id === playerIdToKick);
     if (playerIndex === -1) return;

     const playerToKick = gameState.players[playerIndex];
     const kickedUserId = playerToKick.currentUserId;
     const playerName = playerToKick.name;

     playerToKick.currentUserId = null; // 解除綁定

     saveCurrentPlayerState(playerToKick);

     // 清除待處理請求 (如果該用戶之前有請求，踢人後也應清除)
     for (const reqId in gameState.pendingJoinRequests) {
         if (gameState.pendingJoinRequests[reqId] === playerIdToKick) {
              delete gameState.pendingJoinRequests[reqId];
         }
     }

     const logMsg = `管理員將 ${playerName} (用戶 ID: ${kickedUserId ? kickedUserId.substring(0, 8) + '...' : 'N/A'}) 移除了控制權。`;
     await updateGameState(gameState, logMsg);
     
     // 由於 onSnapshot 會觸發 showPlayerAdminModal 重新渲染，這裡不需要手動呼叫
}

window.handleJoinRequestWrapper = handleJoinRequest;
window.kickPlayer = kickPlayer;


function showPlayerAdminModal() {
    // NEW: 只有 P0 管理員可以進入設定
    if (gameState.players[0].currentUserId !== userId) {
        addLog('錯誤：只有 P0 玩家（管理員）可以修改設定。', 'error');
        return;
    }

    const currentPlayers = gameState.players;
    const isGameStarted = gameState.gameStarted;
    
    // 判斷遊戲管理員
    const gameMaster = currentPlayers[0];
    const isGameMasterDevice = gameMaster && gameMaster.currentUserId === userId;
    const pendingRequests = gameState.pendingJoinRequests;
    const approvalRequired = gameState.settings.joinApprovalRequired; 
    
    // 玩家數量選擇
    const playerCountHtml = `
         <div class="border-b pb-3 mb-4">
              <label for="player-count-select" class="font-bold text-gray-700 block mb-2">設定遊玩人數 (最少 2 位):</label>
              <select id="player-count-select" 
                      class="w-full p-2 border rounded-lg text-center font-bold text-gray-800 ${isGameStarted ? 'bg-gray-200 cursor-not-allowed' : 'focus:outline-none focus:ring-2 focus:ring-indigo-500'}"
                      ${isGameStarted ? 'disabled' : ''}>
                    ${[1, 2, 3, 4].map(n => 
                        `<option value="${n}" ${currentPlayers.filter(p => p.isPlaying).length === n ? 'selected' : ''}>${n} 位玩家</option>`
                       ).join('')}
              </select>
              ${isGameStarted 
                      ? '<p class="text-xs text-red-500 mt-1 font-semibold">遊戲已開始，無法更改人數。請點擊設定中的「重啟遊戲」。</p>' 
                      : (currentPlayers.filter(p => p.isPlaying).length < 2 
                              ? '<p class="text-xs text-red-500 mt-1 font-semibold">需至少 2 位玩家才能開始遊戲。</p>'
                              : '<p class="text-xs text-green-500 mt-1 font-semibold">遊戲人數已滿足，可開始擲骰。</p>')}
         </div>
     `;

    // 個別玩家設定
    const playerSettingsHtml = currentPlayers.map((player, index) => {
        const isPlaying = player.isPlaying;
        const isDisabled = !isPlaying;
        const isCurrentUserId = player.currentUserId || '';
        const isMyPlayer = player.currentUserId === userId;
        
        const isP0 = player.id === 'p0';
        
        // 決定是否顯示踢人按鈕 (功能 4)
        const kickButton = isCurrentUserId && (isGameMasterDevice && !isP0) 
            ? `<button data-player-id="${player.id}" onclick="window.kickPlayer('${player.id}')" 
                             class="py-1 px-3 bg-red-500 text-white rounded text-xs hover:bg-red-600 transition duration-150 ml-auto">
                             踢出/解綁
                             </button>`
            : '';


        return `
             <div class="p-3 mb-3 rounded-lg border ${isPlaying ? 'bg-white border-indigo-200' : 'bg-gray-100 border-gray-300'}" id="player-settings-div-${index}">
                    <div class="flex items-center mb-2">
                             ${player.avatarUrl
                                 ? `<img src="${player.avatarUrl}" 
                                          alt="${player.name} Avatar" 
                                          class="w-8 h-8 rounded-full mr-2 object-cover" 
                                          style="width: 32px; height: 32px;"
                                          onerror="this.onerror=null;this.src='https://placehold.co/32x32/${player.color.substring(1)}/ffffff?text=${player.name[0] || '?'}'"/>`
                                 : `<div class="w-8 h-8 rounded-full mr-2" style="background-color: ${player.color};"></div>`
                                  }
                                <p class="font-bold">玩家 ${index + 1}: ${player.name} ${isMyPlayer ? '(您的角色)' : ''}</p>
                                <span class="text-xs text-gray-500 ml-auto">${isPlaying ? '(啟用中)' : '(已禁用)'}</span>
                                ${kickButton} 
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                                <div>
                                    <label class="block text-xs text-gray-600 mb-1">名稱:</label>
                                    <input type="text" id="player-name-${index}" value="${player.name}" placeholder="玩家名稱" 
                                            class="w-full p-2 border rounded-lg text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                                            ${isDisabled ? 'disabled' : ''}/>
                                    
                                    <label class="block text-xs text-gray-600 mb-1">初始金錢 (僅重啟生效):</label>
                                    <input type="number" id="player-initial-money-${index}" value="${player.money}" min="1000" step="500" placeholder="初始金錢"
                                            class="w-full p-2 border rounded-lg text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-green-500" 
                                            ${isDisabled ? 'disabled' : ''}/>
                                </div>

                                <div>
                                    <label class="block text-xs text-gray-600 mb-1">顏色:</label>
                                    <div class="flex space-x-2 mb-2">
                                        ${PLAYER_COLORS.map((color, colorIndex) => `
                                            <input type="radio" id="player-${index}-color-${colorIndex}" name="player-${index}-color" value="${color}" 
                                                    class="hidden peer" ${player.color === color ? 'checked' : ''} ${isDisabled ? 'disabled' : ''}>
                                            <label for="player-${index}-color-${colorIndex}" 
                                                    class="w-6 h-6 rounded-full cursor-pointer border-2 border-transparent peer-checked:border-indigo-600 transition duration-150"
                                                    style="background-color: ${color};">
                                            </label>
                                        `).join('')}
                                    </div>
                                    <label class="block text-xs text-gray-600 mb-1">頭像 URL (32x32):</label>
                                    <input type="url" id="player-avatar-url-${index}" value="${player.avatarUrl || ''}" placeholder="http://example.com/avatar.png" 
                                            class="w-full p-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                            ${isDisabled ? 'disabled' : ''}/>
                                </div>
                    </div>
                    
                    <div class="mt-4 pt-2 border-t border-gray-200">
                                 <label class="block text-xs text-gray-600 mb-1">綁定用戶 ID (當前操作者):</label>
                                 <p class="text-sm font-mono text-gray-700 break-words bg-yellow-50 p-2 rounded-lg">
                                         ${isCurrentUserId || '<span class="text-gray-400">無人認領/留空</span>'}
                                 </p>
                                 <p class="text-xs text-gray-500 mt-1">此欄位手動編輯已禁用。請使用「認領」或「踢出」按鈕。</p>
                    </div>
             </div>
         `;
    }).join('');
    
    // 待處理請求 UI
    let joinRequestHtml = '';
    if (approvalRequired && isGameMasterDevice) {
         const requestKeys = Object.keys(pendingRequests);
         if (requestKeys.length > 0) {
              const requestsList = requestKeys.map(reqId => {
                  const playerId = pendingRequests[reqId];
                  const playerName = currentPlayers.find(p => p.id === playerId)?.name || `角色 ID: ${playerId}`;
                  return `
                             <div class="flex justify-between items-center p-2 bg-yellow-50 rounded-lg border border-yellow-300 mb-2">
                                 <p class="text-sm font-semibold">用戶 ${reqId.substring(0, 8)}... 請求認領 ${playerName}</p>
                                 <div class="flex space-x-2">
                                     <button onclick="window.handleJoinRequestWrapper('${reqId}', 'approve')" class="py-1 px-3 bg-green-500 text-white rounded text-xs hover:bg-green-600">批准</button>
                                     <button onclick="window.handleJoinRequestWrapper('${reqId}', 'reject')" class="py-1 px-3 bg-gray-500 text-white rounded text-xs hover:bg-gray-600">拒絕</button>
                                 </div>
                             </div>
                             `;
              }).join('');
              
              joinRequestHtml = `
                             <div class="mt-6 pt-4 border-t border-yellow-500">
                                 <p class="font-bold text-yellow-700 mb-3">待處理的加入請求 (${requestKeys.length})</p>
                                 ${requestsList}
                             </div>
                             `;
         } else {
              joinRequestHtml = `
                             <div class="mt-6 pt-4 border-t border-gray-200">
                                 <p class="font-bold text-green-700 mb-1">待處理的加入請求 (0)</p>
                                 <p class="text-xs text-gray-500">目前沒有新的用戶請求加入遊戲。</p>
                             </div>
                             `;
         }
    } else if (approvalRequired && !isGameMasterDevice) {
         joinRequestHtml = `
                         <div class="mt-6 pt-4 border-t border-gray-200">
                             <p class="font-bold text-red-700 mb-1">加入審核已啟用</p>
                             <p class="text-xs text-gray-500">您需要等待 P0 玩家批准您的加入請求後才能認領角色。</p>
                         </div>
                       `;
    }

    
    const contentHtml = `
         <div id="player-admin-content" class="space-y-4">
              ${playerCountHtml}
              <div id="individual-player-settings">${playerSettingsHtml}</div>
              <p id="player-admin-msg" class="text-sm text-green-600 mt-2 font-semibold"></p>
              ${joinRequestHtml} 
              </div>
     `;

    const modalWasOpen = !document.getElementById('modal').classList.contains('hidden');

    // 如果 Modal 已經開啟，則只更新內容，避免閃爍
    if (modalWasOpen && document.getElementById('modal-title').textContent.includes('玩家管理')) {
         document.getElementById('modal-content').innerHTML = contentHtml;
         return;
    }
    
    // 正常顯示流程
    showModal(
        `👤 玩家管理與設置`, 
        '在這裡調整遊玩人數、玩家名稱、初始金錢和代表顏色/頭像。',
        async () => {
            const playerCountSelect = document.getElementById('player-count-select');
            const newPlayerCount = parseInt(playerCountSelect.value);
            
            if (!isGameStarted && newPlayerCount < 2) {
                document.getElementById('player-admin-msg').textContent = '錯誤：至少需要 2 位玩家才能開始遊戲。';
                return;
            }
            
            const playersCopy = gameState.players.map(p => ({...p})); 

            await savePlayerSettings(playersCopy, newPlayerCount, gameState.turn);
            document.getElementById('player-admin-msg').textContent = '設定已成功儲存！';
        },
        contentHtml,
        '儲存玩家設定'
    );

    document.getElementById('modal-cancel-btn').classList.remove('hidden');
    
    document.getElementById('player-count-select').onchange = (e) => {
        if (isGameStarted) return;
        
        const count = parseInt(e.target.value);
        document.getElementById('player-admin-msg').textContent = `注意：更改人數後請點擊「儲存玩家設定」以生效。`;
        
        for (let i = 0; i < 4; i++) {
            const playerDiv = document.getElementById(`player-settings-div-${i}`);
            // P0 永遠啟用
            const enable = i === 0 || i < count; 
            
            playerDiv.querySelectorAll('input, select, button').forEach(el => {
                el.disabled = !enable;
            });

            if (enable) {
                 playerDiv.classList.replace('bg-gray-100', 'bg-white');
                 playerDiv.classList.replace('border-gray-300', 'border-indigo-200');
            } else {
                 playerDiv.classList.replace('bg-white', 'bg-gray-100');
                 playerDiv.classList.replace('border-indigo-200', 'border-gray-300');
            }
        }
    };
}

// ** NEW FIX: 暴露給全局作用域 **
window.showPlayerAdminModal = showPlayerAdminModal;
// ** END NEW FIX **

/**
 * 嘗試認領一個可用的玩家角色 (功能 2: 手動/請求)
 * @param {boolean} isManualClaim - 是否為使用者點擊按鈕手動發起的認領 (影響是否記錄日誌和跳轉到請求模式)
 */
async function claimPlayerSlot(isManualClaim = false, playerIdToClaim = null) { 
     if (!gameState || userId === 'loading') return;
     
     // 1. 檢查自己是否已經認領了角色
     const existingPlayer = gameState.players.find(p => p.currentUserId === userId);
     if (existingPlayer) {
         if (isManualClaim) addLog(`您已是 ${existingPlayer.name}，無需重複認領。`);
         setControlState(); 
         return;
     }
     
     const gameMaster = gameState.players[0];
     const isGameMasterDevice = gameMaster && gameMaster.currentUserId === userId;
     
     // --- A. 管理員 P0 自動認領 (僅在啟動時執行，且 P0 尚未被綁定) ---
     if (gameMaster && gameMaster.id === 'p0' && gameMaster.currentUserId === null && !isManualClaim) {
         gameMaster.currentUserId = userId; 
         gameMaster.isPlaying = true; 
         gameMaster.lastActiveTimestamp = Date.now(); // 設置初始活躍時間
         saveCurrentPlayerState(gameMaster);
         await updateGameState(gameState, `管理員 P0 (${gameMaster.name}) 自動認領完成。`);
         return; 
     }
     
     // --- B. 尋找並認領/請求其他角色 (P1, P2, P3) ---
     
     let playerToClaim;
     if (playerIdToClaim) {
         playerToClaim = gameState.players.find(p => p.id === playerIdToClaim);
     } else {
         // 如果沒有指定 ID，尋找第一個未被認領且已啟用的角色（這是給浮動按鈕用的邏輯）
         playerToClaim = gameState.players.find(p => p.id !== 'p0' && p.isPlaying && p.currentUserId === null);
     }

     if (!playerToClaim || !playerToClaim.isPlaying || playerToClaim.currentUserId !== null) {
         if (isManualClaim) addLog('目前沒有可認領的玩家角色。請管理員在「玩家管理」中啟用新的角色。', 'error');
         return;
     }
     
     // 如果不是手動點擊，則不繼續執行（避免不必要的請求）
     if (!isManualClaim) return;
     
     const approvalRequired = gameState.settings.joinApprovalRequired;
     
     // --- 判斷是否需要審核 ---
     if (approvalRequired && !isGameMasterDevice) { 
         // 提交請求
         if (gameState.pendingJoinRequests[userId] !== playerToClaim.id) {
              // 檢查是否正在請求其他角色，如果是，則提示
              const isRequestingOtherPlayer = Object.keys(gameState.pendingJoinRequests).some(reqId => 
                              reqId !== userId && gameState.pendingJoinRequests[reqId] === playerToClaim.id
              );
              
              if (isRequestingOtherPlayer) {
                   addLog(`角色 ${playerToClaim.name} 正在被其他用戶請求中，請選擇其他角色。`, 'error');
                   return;
              }
              
              gameState.pendingJoinRequests = { ...gameState.pendingJoinRequests, [userId]: playerToClaim.id };
              
              await updateGameState(gameState, `新用戶 (ID: ${userId.substring(0, 8)}...) 請求加入遊戲 (角色: ${playerToClaim.name})。等待 P0 審核。`);
              addLog(`您的加入請求 (角色: ${playerToClaim.name}) 已送出，請等待遊戲管理員 (P0) 批准。`, 'info');
         } else {
              addLog(`您的加入請求 (角色: ${playerToClaim.name}) 正在等待 P0 批准中...`, 'info');
         }
         return; 
     }
     
     // --- 無需審核的自動認領（或 P0 設備認領） ---
     if (isManualClaim && isGameMasterDevice) {
         // 如果是 P0 管理員點擊，則直接認領 (繞過請求機制)
          playerToClaim.currentUserId = userId; 
          playerToClaim.lastActiveTimestamp = Date.now();
         
          // 清除當前用戶可能綁定的其他角色
          gameState.players.forEach(p => {
              if (p.currentUserId === userId && p.id !== playerToClaim.id) {
                  p.currentUserId = null;
              }
          });
         
          if (gameState.pendingJoinRequests[userId]) {
               delete gameState.pendingJoinRequests[userId];
          }

          saveCurrentPlayerState(playerToClaim);
         
          // 立即更新本地 UI，避免 Firestore 延遲
          renderPlayerStats();
          setControlState(); 
         
          const logMsg = `管理員手動將 ${playerToClaim.name} 綁定給當前用戶 (ID: ${userId.substring(0, 8)}...)。`;
          await updateGameState(gameState, logMsg);
          addLog(`成功認領 ${playerToClaim.name}。`);
          return;
     }
}

/**
 * 處理玩家資訊卡點擊事件 (問題 6 修正)
 */
window.handlePlayerCardClick = (playerIndex) => { 
     if (!gameState || userId === 'loading') return;
     
     const clickedPlayer = gameState.players[playerIndex];
     const existingPlayer = gameState.players.find(p => p.currentUserId === userId);
     
     // 1. 如果點擊的是自己，或自己已認領角色，顯示資產
     if (existingPlayer || clickedPlayer.currentUserId === userId) {
         window.showPlayerAssetsModal(clickedPlayer.id);
         return;
     }
     
     // 2. 如果點擊的角色是啟用中且無人認領，則彈窗確認認領/請求
     if (clickedPlayer.isPlaying && clickedPlayer.currentUserId === null) {
          const isPending = gameState?.pendingJoinRequests ? Object.keys(gameState.pendingJoinRequests).includes(userId) : false;
          
          if (isPending) {
               // 如果已經有請求，提示正在等待
               const requestedPlayerId = gameState.pendingJoinRequests[userId];
               const requestedPlayer = gameState.players.find(p => p.id === requestedPlayerId);
               showModal(
                    '⚠️ 請求正在處理中',
                    `<p class="text-lg">您已經請求認領 **${requestedPlayer.name}** 角色。請等待遊戲管理員 (P0) 批准。</p>`,
                    () => {},
                    null,
                    '確認'
               );
               return;
           }
          
          // 彈窗確認
          showModal(
                       '🔗 認領角色請求',
                       `<p class="text-lg">您確定要請求認領 **${clickedPlayer.name}** 角色嗎？</p>
                             <p class="mt-2 text-sm text-red-500">此操作需要遊戲管理員 (P0) 批准。</p>`,
                       () => {
                            // 確認後執行認領/請求邏輯
                            claimPlayerSlot(true, clickedPlayer.id); 
                       },
                       null,
                       '確認認領'
                     );
           document.getElementById('modal-cancel-btn').classList.remove('hidden'); 
          
     } else if (clickedPlayer.isPlaying && clickedPlayer.currentUserId !== null) {
          // 角色已被其他人認領
          addLog(`錯誤：${clickedPlayer.name} 角色已被其他用戶認領。`, 'error');
     } else {
          // 角色已禁用
          addLog(`錯誤：${clickedPlayer.name} 角色已禁用。`, 'error');
     }
};


/**
 * [重新啟用] 管理員強制接管功能 (用於解決 P0 長時間離線問題)
 */
async function forceAdminTakeover() {
     if (!gameState || !gameState.players[0]) return;
     
     const gameMaster = gameState.players[0];

     if (gameMaster.currentUserId === userId) {
          addLog('您已經是遊戲管理員 (P0)！無需強制接管。', 'info');
          return;
     }
     
     // 檢查 P0 是否已被綁定
     if (gameMaster.currentUserId === null) {
          addLog('P0 角色尚未認領，請使用「請求加入遊戲」按鈕認領一個空閒角色。', 'info');
          return;
     }
     
     // 檢查 P0 是否處於非活躍狀態 (60 秒)
     const timeSinceLastActive = Date.now() - gameMaster.lastActiveTimestamp;
     if (timeSinceLastActive < TAKEOVER_TIMEOUT_MS) {
          addLog(`無法接管：管理員 (${gameMaster.name}) 最近 (${Math.floor(timeSinceLastActive / 1000)} 秒前) 仍處於活躍狀態。需等待 60 秒非活躍。`, 'error');
          return;
     }
     
     // 強制接管 P0 角色
     const playersCopy = gameState.players.map(p => {
          if (p.id === 'p0') {
              return { ...p, currentUserId: userId, lastActiveTimestamp: Date.now() };
          }
          // 清除當前用戶可能綁定的其他角色
          if (p.currentUserId === userId) {
               return { ...p, currentUserId: null };
          }
          return p;
     });
     
     // 清空待處理請求 (避免接管後舊的請求仍然指向 P0)
     const pendingJoinRequests = {};
     
     const nextState = { 
          ...gameState, 
          players: playersCopy, 
          pendingJoinRequests: pendingJoinRequests 
     };
     
     await updateGameState(nextState, `🚨 緊急接管：用戶 ${userId.substring(0, 8)}... 強制接管了管理員 P0 角色 (原用戶長時間不活躍)。`);
     
     showModal(
          '🚨 管理員接管成功',
          `<p class="text-lg text-red-600 font-bold">您已成功強制接管管理員 (P0) 角色！</p><p class="mt-2 text-sm">現在您可以控制設定和玩家管理。</p>`,
          () => {},
          null,
          '確認'
     );
}


async function fetchSuburbSummary(suburbName) {
     // !!! 部署警告 !!!
     // 在 Canvas 沙盒環境外（例如 Neocities）呼叫此 API，將會因為缺少伺服器端身份驗證
     // 而導致 403 錯誤。在外部部署時，您需要建立一個伺服器端代理 (Server-Side Proxy)
     // 來安全地儲存 API Key 並代為呼叫此服務。
     const systemPrompt = "Act as a local historian and real estate expert. Provide a concise, single-paragraph summary of this Melbourne suburb, focusing on its character, significance, and history. The response must be in Traditional Chinese.";
     const userQuery = `Summarize the Melbourne suburb: ${suburbName}`;
     const apiKey = "" 
     // 修正：移除 URL 中的 ?key=${apiKey}，避免在運行環境自動注入密鑰時發生衝突，導致 403 錯誤。
     const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent`;
     
     const payload = {
         contents: [{ parts: [{ text: userQuery }] }],
         tools: [{ "google_search": {} }],
         systemInstruction: {
              parts: [{ text: systemPrompt }]
         },
     };

     let result;
     for (let attempt = 0; attempt < 5; attempt++) {
          try {
               const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
               });
               
               if (!response.ok) {
                    const errorBody = await response.json();
                    throw new Error(`API 錯誤 (狀態碼 ${response.status}): ${errorBody.error?.message || '未知錯誤'}`);
               }
               
               result = await response.json();
               break; 
              } catch (error) {
                    if (attempt === 4) throw new Error("API call failed after multiple retries: " + error.message);
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
               }
     }

     const candidate = result.candidates?.[0];

     if (candidate && candidate.content?.parts?.[0]?.text) {
         const text = candidate.content.parts[0].text;

         let sources = [];
         const groundingMetadata = candidate.groundingMetadata;
         if (groundingMetadata && groundingMetadata.groundingAttributions) {
              sources = groundingMetadata.groundingAttributions
                              .map(attribution => ({ uri: attribution.web?.uri, title: attribution.web?.title }))
                              .filter(source => source.uri && source.title);
         }

         return { text, sources };

     } else {
         throw new Error(result.promptFeedback?.blockReason || "未生成文本 (可能違反安全政策或內容被屏蔽)。");
     }
}

/**
 * 顯示地產簡介模態視窗 (問題 3 修正: 確保可點擊)
 */
async function showPropertyInfoModal(square, currentPlayer) {
     if (!gameState) return; // 確保有狀態
     const squareIndex = gameState.board.findIndex(s => s.name === square.name && s.type === 'PROPERTY');
     const currentSquare = gameState.board[squareIndex];
     const propertyName = currentSquare.name;

     const currentImageUrl = currentSquare.imageUrl || '';
     const defaultPlaceholderUrl = `https://placehold.co/300x200/4f46e5/ffffff?text=${encodeURIComponent(currentSquare.name + ' (Placeholder)')}`;
     const displayUrl = currentImageUrl || defaultPlaceholderUrl;

     const modalTitle = `[${currentPlayer.name}] 地產簡介: ${currentSquare.name}`; 
     
     // --- Helper to render summary in modal ---
     function renderSummary(summaryData, isError = false) {
          const container = document.getElementById('summary-and-source-area');
          if (!container) return;
          
          if (isError) {
               container.innerHTML = `<p class="text-red-500 font-bold">載入簡介失敗</p><p class="text-sm mt-2">${summaryData}</p>`;
               return;
          }
          
          const summaryHtml = `<p class="text-base text-gray-600">${summaryData.text}</p>`;
          
          const sourcesHtml = summaryData.sources?.length > 0 ? 
                             `<div class="mt-4 pt-2 border-t border-gray-200 text-xs text-gray-500">
                                  <p class="font-semibold mb-1">來源參考:</p>
                                  <ul class="list-disc list-inside space-y-1">${summaryData.sources.map(s => `<li><a href="${s.uri}" target="_blank" class="text-blue-500 hover:underline">${s.title}</a></li>`).join('')}</ul>
                              </div>` : '';
          
          container.innerHTML = summaryHtml + sourcesHtml;
     }
     // --- End Helper ---

     // Check cache first
     const cachedSummary = gameState.settings?.suburbSummaries?.[propertyName];
     
     let initialSummaryHtml;
     if (cachedSummary) {
          initialSummaryHtml = ''; // Will be rendered immediately by renderSummary after modal opens
     } else {
          // Use loading state if not cached
          initialSummaryHtml = `<div id="suburb-summary-container">
                                      <div class="text-center py-4 text-indigo-600 font-semibold">
                                          <span class="animate-spin inline-block w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full mr-2"></span>
                                           載入 ${currentSquare.name} 的簡介...
                                       </div>
                                     </div>`;
     }

     // *** NEW: 房屋和租金詳情顯示 ***
     const isOwned = currentSquare.owner !== null;
     const ownerName = isOwned ? (gameState.players.find(p => p.id === currentSquare.owner)?.name || '未知') : '無主';
     const currentHouses = currentSquare.houses;
     const rentDetails = currentSquare.rentMultipliers.map((multiplier, index) => {
         const levelName = index === 0 ? '無房屋 (基礎)' : (index === HOUSE_CONFIG.MAX_HOUSES ? '大樓 🏢' : `房屋 ${index} 🏡`);
         const rent = currentSquare.rent * multiplier;
         return `<span class="text-xs ${index === currentHouses ? 'font-bold text-red-600' : 'text-gray-600'}">${levelName}: $${rent.toLocaleString()}</span>`;
     }).join(' | ');


     const contentTemplate = `
          <div class="space-y-4">
                  <div class="bg-gray-100 p-4 rounded-lg">
                       <p class="font-bold text-gray-800 mb-2">地產狀態</p>
                       <p class="text-sm text-gray-700">地產所有者: <span class="font-bold">${ownerName}</span></p>
                       <p class="text-sm text-gray-700">地產價格: <span class="font-bold">$${currentSquare.price.toLocaleString()}</span></p>
                       <p class="text-sm text-gray-700">房屋數: <span class="font-bold">${currentHouses} / ${HOUSE_CONFIG.MAX_HOUSES}</span> (${currentSquare.mortgage ? '已抵押 🔒' : '未抵押'})</p>
                       <p class="text-sm text-gray-700 mt-2">升級費用 (每級): <span class="font-bold">$${currentSquare.housePrice.toLocaleString()}</span></p>
                  </div>
                  
                  <div class="p-4 bg-yellow-50 rounded-lg overflow-x-auto">
                       <p class="font-bold text-gray-700 mb-2 whitespace-nowrap">租金詳情 (${currentSquare.rent.toLocaleString()} x 倍率)</p>
                       <div class="flex space-x-3 whitespace-nowrap">
                           ${rentDetails}
                       </div>
                  </div>


                  <div class="bg-gray-100 p-4 rounded-lg text-center border-2 border-dashed border-gray-300">
                       <p class="text-sm text-gray-500 mb-2">地產圖片</p>
                       <img id="property-modal-image" src="${displayUrl}" 
                              onerror="this.onerror=null;this.src='${defaultPlaceholderUrl}'"
                              alt="Image for ${currentSquare.name}" class="mt-2 mx-auto rounded w-full h-auto max-h-48 object-cover"/>
                  </div>
                  
                  <div id="summary-and-source-area">
                          ${initialSummaryHtml}
                  </div>
                  
                  <div class="mt-4 pt-4 border-t border-gray-200">
                       <p class="font-bold text-gray-700 mb-2">圖片設定 (可設定持久化 URL)</p>
                       <input type="url" id="image-url-input" value="${currentImageUrl}" placeholder="輸入圖片 URL (例如: https://...)" class="w-full p-2 border rounded-lg text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                       <button id="save-image-url-btn" class="w-full py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition duration-150 disabled:opacity-50">儲存圖片 URL</button>
                       <p id="image-url-msg" class="text-xs text-red-500 mt-1"></p>
                  </div>
          </div>
     `;
     // *** END NEW ***
     
     showModal(modalTitle, '地產簡介與圖片設定:', () => {}, contentTemplate, '關閉');
     
     // 修正 1: 頂部關閉按鈕事件
     document.getElementById('modal-top-close-btn').onclick = () => {
          document.getElementById('modal').classList.add('hidden');
          document.getElementById('modal').classList.remove('flex');
     };

     const confirmBtn = document.getElementById('modal-confirm-btn');
     confirmBtn.textContent = '關閉';
     confirmBtn.onclick = () => {
          document.getElementById('modal').classList.add('hidden');
          document.getElementById('modal').classList.remove('flex');
     };
     
     // 綁定儲存圖片按鈕
     document.getElementById('save-image-url-btn').onclick = async () => {
          const urlInput = document.getElementById('image-url-input');
          const newUrl = urlInput.value.trim();
          const msg = document.getElementById('image-url-msg');

          if (squareIndex === -1) { msg.textContent = '錯誤: 無法找到地產索引。'; return; }
          
          const newBoard = gameState.board.map((s, index) => {
               if (index === squareIndex) { return { ...s, imageUrl: newUrl || null }; }
               return s;
          });
          
          const propertyName = currentSquare.name;
          gameState.settings.propertyImageUrls = {
               ...gameState.settings.propertyImageUrls,
               [propertyName]: newUrl || null 
          };

          const nextState = { ...gameState, board: newBoard };
          await updateGameState(nextState, `${currentPlayer.name} 更新了地產 ${currentSquare.name} 的圖片 URL。`);
          
          msg.textContent = '圖片 URL 已儲存並同步！';
          const imageElement = document.getElementById('property-modal-image');
          if (imageElement) { imageElement.src = newUrl || defaultPlaceholderUrl; }
     };

     // --- Async load/cache logic ---
     if (cachedSummary) {
          renderSummary(cachedSummary);
     } else {
          // 執行 Gemini API 呼叫
          try {
               const summary = await fetchSuburbSummary(propertyName);
               
               // 成功：更新 UI
               renderSummary(summary);
               
               // 成功：更新緩存並儲存到 Firestore
               gameState.settings.suburbSummaries = {
                       ...gameState.settings.suburbSummaries,
                       [propertyName]: {
                            text: summary.text,
                            sources: summary.sources,
                       }
               };
               // 只更新狀態，不需要額外日誌
               await updateGameState(gameState); 
               
              } catch (error) {
                     const errorMessage = error.message.includes("API call failed") ? 
                          `連線或 API 呼叫失敗，請檢查網路或重試。` : 
                          `內容生成失敗 (可能內容被屏蔽): ${error.message}`;
                      
                     renderSummary(errorMessage, true);
                     console.error("Gemini API Call Failed:", error);
              }
     }
     // --- End Async load/cache logic ---
}

/**
 * 處理棋盤方格點擊事件
 */
function handleSquareClick(squareIndex) { // FIX: Changed from arrow function assignment
     if (!gameState) {
         addLog('遊戲狀態尚未載入，無法查看地產資訊。', 'info');
         return;
     }
     const square = gameState.board[squareIndex];
     // 獲取當前用戶控制的玩家，如果沒有則使用回合玩家作為預設
     const currentPlayer = gameState.players.find(p => p.currentUserId === userId) || gameState.players[gameState.turn];
     
     if (square.type === 'PROPERTY') {
         showPropertyInfoModal(square, currentPlayer);
     }
}
window.handleSquareClick = handleSquareClick; // FIX: Explicitly expose

/**
 * 顯示資產模態視窗 (問題 6 修正: 顯示玩家總資產)
 */
function showPlayerAssetsModal(playerId) { // FIX: Changed from arrow function assignment
     if (!gameState) return;
     const player = gameState.players.find(p => p.id === playerId);
     // [修正 5] 不顯示未啟用玩家的資產詳情
     if (!player || !player.isPlaying) { 
         addLog(`${player.name} 已破產或未啟用，無法查看資產詳情。`, 'info');
         return;
     }

     let totalStockValue = 0;
     const stockDetails = gameState.currentStocks.map(stock => {
         const count = player.stocks[stock.symbol] || 0; // FIX: Use stock.symbol instead of s.symbol 
         if (count > 0) {
             const value = count * stock.price;
             totalStockValue += value;
             return `
                      <div class="flex justify-between text-sm py-1 border-b border-gray-100">
                          <span class="font-semibold">${stock.name} (${stock.symbol})</span>
                          <span class="text-gray-600">持股: ${count} 股</span>
                          <span class="text-emerald-600">市價: $${stock.price.toLocaleString()}</span>
                          <span class="font-bold">總值: $${value.toLocaleString()}</span>
                      </div>
                     `;
         }
         return '';
     }).filter(d => d !== '').join('');

     let totalPropertyValue = 0;

     const propertyDetailsHtml = player.properties.length > 0
         ? player.properties.map(propName => {
              const square = gameState.board.find(s => s.name === propName); // ** 修正：使用 gameState.board **
              if (!square) return ''; 
              
              const rent = calculateRent(square); // 計算當前租金
              const rentDisplay = square.mortgage ? '抵押中 🔒' : `$${rent.toLocaleString()}`;
              const houseCount = square.houses;
              
              // 計算地產總價值 (地產價格 + 房屋成本)
              const houseCost = square.housePrice * houseCount;
              const propertyValue = square.price + houseCost;
              totalPropertyValue += propertyValue;

              const color = square.color;
              const hexColor = COLOR_MAP[color] || '#9ca3af'; 
              
              let houseIcon = '';
              if (houseCount > 0) {
                   houseIcon = Array(houseCount).fill(0).map((_, i) => {
                        let iconClass, iconText;
                        if (i === HOUSE_CONFIG.MAX_HOUSES - 1) { 
                            iconClass = 'skyscraper'; iconText = '大'; // 大樓
                        } else if (i >= 2) { 
                            iconClass = 'apartment'; iconText = '公'; // 公寓
                        } else {
                            iconClass = 'house'; iconText = '房'; // 房屋
                        }
                        return `<span class="house-icon ${iconClass}">${iconText}</span>`;
                   }).join('');
              }
              
              // **問題 6 修正：點擊地產卡片查看詳細資訊**
              return `
                         <div class="inline-flex items-center px-3 py-1 rounded-full shadow-sm text-xs font-semibold 
                              bg-white border-2 border-gray-300 transition duration-150 hover:shadow-md cursor-pointer"
                              onclick="window.handleSquareClick(${square.index})" 
                              title="點擊查看 ${propName} 簡介"
                              style="border-color: ${hexColor};">
                              
                             <span class="w-3 h-3 rounded-full mr-2" style="background-color: ${hexColor};"></span>
                             
                             <span class="text-gray-800 mr-2 whitespace-nowrap">${propName}</span>
                             
                             ${houseIcon}
                             
                             <span class="text-gray-500 whitespace-nowrap ml-2">(${rentDisplay})</span>
                         </div>
                         `;
           }).join('')
           : '<p class="text-sm text-gray-500">無已購地產。</p>';

     // NEW: 總資產計算包含房屋價值
     const totalAssets = player.money + player.bank + totalStockValue + totalPropertyValue;


     const contentHtml = `
          <div class="space-y-4">
                  <div class="p-3 bg-indigo-50 rounded-lg shadow-inner">
                       <p class="text-2xl font-extrabold text-indigo-700">總資產: $${totalAssets.toLocaleString()}</p>
                  </div>

                  <div class="border-b pb-2">
                       <p class="font-bold text-gray-700">現金與定存</p>
                       <p class="text-sm">現金: <span class="font-semibold">$${player.money.toLocaleString()}</span></p>
                       <p class="text-sm">定存: <span class="font-semibold">$${player.bank.toLocaleString()}</span> (利率: ${(gameState.settings.interestRate * 100).toFixed(2)}%)</p>
                  </div>

                  <div>
                       <p class="font-bold text-gray-700 mb-2">股票投資組合 (總價值 $${totalStockValue.toLocaleString()})</p>
                       <div class="max-h-40 overflow-y-auto space-y-1 p-2 bg-white border rounded">
                               ${stockDetails || '<p class="text-sm text-gray-500">無持股。</p>'}
                       </div>
                  </div>

                  <div>
                       <p class="font-bold text-gray-700 mb-2">已購地產 (${player.properties.length} 塊, 總價值 $${totalPropertyValue.toLocaleString()})</p>
                       <div class="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2 bg-white border rounded">
                               ${propertyDetailsHtml}
                       </div>
                  </div>
          </div>
     `;

     showModal(
         `[${player.name}] 玩家資產報告`,
         '以下是您目前的財務和地產狀況：',
         () => {}, 
         contentHtml,
         '關閉'
     );
}
window.showPlayerAssetsModal = showPlayerAssetsModal; // FIX: Explicitly expose

/**
 * 渲染頂部警報區 (新增功能)
 */
function renderHeaderAlerts() {
    const alertArea = document.getElementById('admin-alert-area');
    alertArea.innerHTML = ''; // 清除舊警報

    if (!gameState || userId === 'loading') return;

    const gameMaster = gameState.players[0];
    const isGameMasterDevice = gameMaster && gameMaster.currentUserId === userId;
    const pendingRequests = gameState.pendingJoinRequests;
    const requestKeys = Object.keys(pendingRequests);
    const pendingCount = requestKeys.length;
    
    // **[NEW] 更新回合數顯示**
    document.getElementById('turn-display').textContent = gameState.round;

    if (isGameMasterDevice && pendingCount > 0) {
        // 找出第一個請求的用戶 ID 和角色 ID
        const requestingUserId = requestKeys[0]; // First user in queue
        const requestedPlayerId = pendingRequests[requestKeys[0]];
        const requestedPlayer = gameState.players.find(p => p.id === requestedPlayerId);
        const playerName = requestedPlayer ? requestedPlayer.name : '未知角色';
        
        // 顯示的用戶 ID 縮短
        const displayUserId = requestingUserId.substring(0, 8) + '...';
        
        const message = `
              <div class="p-3 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 rounded-lg shadow-md flex justify-between items-center flex-wrap gap-2">
                  <span class="font-bold">⚠️ 待處理的加入請求 (${pendingCount})</span>
                  <span class="text-sm text-gray-700 truncate max-w-[40%]">
                      用戶 ${displayUserId} 請求認領 ${playerName}。
                  </span>
                  <div class="flex space-x-2 flex-shrink-0">
                       <button onclick="window.handleJoinRequestWrapper('${requestingUserId}', 'approve')" 
                               class="py-1 px-3 bg-green-500 text-white text-xs font-bold rounded hover:bg-green-600 transition">
                               ✅ 批准
                       </button>
                       <button onclick="window.handleJoinRequestWrapper('${requestingUserId}', 'reject')" 
                               class="py-1 px-3 bg-gray-500 text-white text-xs font-bold rounded hover:bg-gray-600 transition">
                               ❌ 拒絕
                       </button>
                       ${pendingCount > 1 ? `
                               <button onclick="window.showPlayerAdminModal()" 
                                       class="py-1 px-3 bg-yellow-500 text-white text-xs font-bold rounded hover:bg-yellow-600 transition">
                                       +${pendingCount - 1}
                               </button>
                       ` : ''}
                  </div>
              </div>
            `;
        alertArea.innerHTML = message;
    }
}


function renderPlayerStats() {
    const statsDiv = document.getElementById('player-stats');
    
    // [修正 5] 只渲染 isPlaying=true 的玩家
    statsDiv.innerHTML = gameState.players
        .filter(p => p.isPlaying)
        .map((player, index) => {
        // 必須使用 findIndex 來匹配在完整陣列中的索引
        const playerGlobalIndex = gameState.players.findIndex(p => p.id === player.id);
        const isCurrent = gameState.turn === playerGlobalIndex;
        const isClaimed = player.currentUserId !== null;
        const isMyPlayer = player.currentUserId === userId;
        
        const stockSummary = gameState.currentStocks.map(s => {
            const count = player.stocks[s.symbol] || 0; 
            return count > 0 ? `${s.symbol}: ${count}` : null;
        }).filter(Boolean).join(' | ');
        
        // 修正 2: 點擊認領邏輯調整
        let cardClass = '';
        let buttonAction = `window.handlePlayerCardClick(${playerGlobalIndex})`;
        let cardTitle = '';
        
        if (isMyPlayer) {
            cardClass = 'shadow-2xl border-indigo-700 ring-2 ring-indigo-500 cursor-pointer hover:bg-indigo-100';
            cardTitle = `點擊查看您的資產`;
        } else if (player.isPlaying && !isClaimed) {
            // 可被認領的卡片
            cardClass = 'shadow-lg border-green-500 ring-2 ring-green-300 cursor-pointer hover:bg-green-50';
            cardTitle = `點擊請求認領 ${player.name}`;
        } else if (isClaimed) {
            cardClass = 'shadow-lg border-gray-300 cursor-default';
            cardTitle = `已被 ${player.currentUserId.substring(0, 8)}... 認領`;
        } else {
            cardClass = 'opacity-30 border-gray-300 cursor-default';
            cardTitle = '角色已禁用或破產';
        }
        
        const isUserUnbound = !gameState.players.some(p => p.currentUserId === userId);
        const isClaimable = player.isPlaying && !isClaimed;

        const buttonDisabledClass = isMyPlayer || (isClaimable && isUserUnbound) ? 'hover:scale-105 cursor-pointer' : 'cursor-default';
        
        // 【修正 3】新增綠色打勾符號 (✅)
        const controlInfo = player.currentUserId 
             ? (player.currentUserId === userId ? '您 (控制中) ✅' : `ID: ${player.currentUserId.substring(0, 8)}...`)
             : '無主 (可認領)'; 

        // 【修正 3.1】放大玩家卡片上的頭像到 w-12 h-12 (48px)
        const avatarContent = `<button 
                                     class="player-avatar-large rounded-full mr-2 object-cover overflow-hidden transition duration-150 shadow-md flex-shrink-0 ${buttonDisabledClass}" 
                                     onclick="${buttonAction}" 
                                     title="${cardTitle}">
                                     ${player.avatarUrl
                                         ? `<img src="${player.avatarUrl}" 
                                                  alt="${player.name} Avatar" 
                                                  class="w-full h-full object-cover" 
                                                  onerror="this.onerror=null;this.src='https://placehold.co/48x48/${player.color.substring(1)}/ffffff?text=${player.name[0] || '?'}'"/>`
                                         : `<div class="w-full h-full flex justify-center items-center text-lg font-bold text-white" 
                                                  style="background-color: ${player.color};">${player.name[0] || '?'}</div>`
                                                 }
                                     </button>`;

        return `
             <div class="p-4 rounded-xl border-2 ${isCurrent ? 'border-4 border-yellow-500 bg-yellow-50' : cardClass} transition duration-200"
                      onclick="${buttonAction}" title="${cardTitle}">
                      <div class="flex items-center justify-between mb-2">
                             <div class="flex items-center">
                                 ${avatarContent}
                                 
                                 <h4 class="font-bold text-lg text-gray-800">
                                     ${player.name}
                                 </h4>
                             </div>
                             <span class="text-xs text-gray-500">${controlInfo}</span>
                      </div>
                      <p class="text-xl font-extrabold text-gray-900">$${player.money.toLocaleString()}</p>
                      <p class="text-sm text-gray-500">定存: <span class="font-bold text-gray-800">$${player.bank.toLocaleString()}</span></p> 
                      <p class="text-xs text-gray-400 truncate mt-1" title="${stockSummary || '無持股'}">持股: ${stockSummary || '無'}</p> 
                      <p class="text-xs text-gray-500 truncate mt-1" title="${player.properties.join(', ')}">位置: ${gameState.board[player.position].name} (${player.position}) ${player.inJail ? `(監獄中，剩 ${player.jailTurns} 回合)` : ''}</p>
                  </div>
             `;
    }).join('');
}

function renderBoardDisplay() {
    const boardDiv = document.getElementById('board-display');
    
    if (!gameState || !gameState.board) {
        boardDiv.innerHTML = '<p class="text-center text-gray-500 py-4">棋盤數據載入中...</p>';
        return;
    }
    
    const currentPlayerId = gameState.players[gameState.turn].id;

    boardDiv.innerHTML = gameState.board.map((square, index) => { 
        const playersAtSquare = gameState.players.filter(p => p.position === index && p.isPlaying);
        const isOwned = square.owner !== null; 
        const ownerPlayer = isOwned ? gameState.players.find(p => p.id === square.owner) : null;
        const ownerColor = ownerPlayer ? ownerPlayer.color : 'transparent';
        
        let textColor = 'text-white'; 
        if (square.color.includes('-300') || square.color === 'bg-yellow-400' || square.color === 'bg-gray-400' || square.color === 'bg-red-600' || square.color === 'bg-yellow-200' || square.color === 'bg-orange-400' || square.color === 'bg-red-400' || square.color === 'bg-gray-100' || square.color === 'bg-green-500') {
             textColor = 'text-gray-800';
        }
        if (square.color.includes('bg-green-600') || square.color.includes('bg-red-600') || square.color.includes('bg-purple-600') || square.color === 'bg-red-900' || square.color === 'bg-pink-900') {
             textColor = 'text-white';
        }
        
        const hexColor = COLOR_MAP[square.color] || '#f3f4f6'; 
        const hasPlayer = playersAtSquare.length > 0;

        const baseClass = `min-w-[120px] h-32 p-2 rounded-lg shadow-xl border-b-4 border-r-2 border-gray-500 flex flex-col justify-between transition-all duration-300 transform cursor-pointer`;
        const activeClass = hasPlayer ? 'scale-105 border-yellow-500 border-4' : '';

        // --- NEW: 處理棋子重疊邏輯 (只顯示一個棋子，優先顯示當前玩家) ---
        let tokensToRender = [];
        if (playersAtSquare.length > 0) {
            const currentTurnPlayerAtSquare = playersAtSquare.find(p => p.id === currentPlayerId);
            
            // 優先顯示當前回合的玩家，如果他/她在這格
            if (currentTurnPlayerAtSquare) {
                 tokensToRender = [currentTurnPlayerAtSquare];
            } else {
                 // 否則，顯示該格上的第一個玩家
                 tokensToRender = [playersAtSquare[0]];
            }
        }

        const playerTokensHtml = tokensToRender.map(p => {
            const highlightClass = 'border-yellow-400 ring-2 ring-yellow-400'; 
            
            // NEW: 檢查 custom avatar URL
            let tokenStyle = `background-color: ${p.color};`;
            let tokenContent = p.name[0] || '?';
            let tokenClass = '';

            if (p.avatarUrl) {
                 tokenStyle = `background-image: url('${p.avatarUrl}'); background-size: cover; background-position: center;`; 
                 tokenContent = '';
            } else {
                 tokenClass = 'text-white';
            }

            return `<div class="player-token-container"> 
                             <div class="player-token-inner ${tokenClass} ${highlightClass}" 
                                  data-player-id="${escapeHtml(p.id)}"
                                  style="${tokenStyle}">
                                  ${tokenContent}
                             </div>
                         </div>`;
        }).join('');
        // --- END NEW: 處理棋子重疊邏輯 ---
        
        // *** NEW: 房屋數量顯示邏輯 ***
        let houseIconsHtml = '';
        if (square.type === 'PROPERTY' && square.houses > 0) {
             const houseCount = square.houses;
             // 根據房屋數量，渲染不同圖標
             houseIconsHtml = Array(houseCount).fill(0).map((_, i) => {
                  let iconClass, iconText;
                  if (i === HOUSE_CONFIG.MAX_HOUSES - 1) { 
                      iconClass = 'skyscraper'; iconText = '大'; 
                  } else if (i >= 2) { 
                      iconClass = 'apartment'; iconText = '公'; 
                  } else {
                      iconClass = 'house'; iconText = '房'; 
                  }
                  return `<span class="house-icon ${iconClass}">${iconText}</span>`;
             }).join('');
        }
        
        // 租金或價格顯示
        let priceOrRentHtml = '';
        if (square.type === 'PROPERTY') {
            if (square.mortgage) {
                 priceOrRentHtml = `<p class="text-xs text-red-600 font-bold">已抵押 🔒</p>`;
            } else {
                 const currentRent = calculateRent(square);
                 priceOrRentHtml = `<p class="text-xs ${textColor}">租: $${currentRent.toLocaleString()}</p>`;
            }
        } else if (square.action) {
            priceOrRentHtml = `<p class="text-xs ${textColor}">金額: $${square.action.toLocaleString()}</p>`;
        } else {
            priceOrRentHtml = `<p class="text-xs ${textColor}">${square.type}</p>`;
        }


        return `
             <div id="square-${index}" 
                     class="${baseClass} ${activeClass} relative" 
                     style="background-color: ${hexColor};"
                     onclick="${square.type === 'PROPERTY' ? `handleSquareClick(${index})` : ''}"> 
                     <div class="flex justify-between items-center w-full">
                         <p class="text-xs font-semibold overflow-hidden whitespace-nowrap ${textColor}">#${index} ${square.name}</p>
                         <div class="flex">
                             ${houseIconsHtml}
                         </div>
                     </div>
                     
                     ${priceOrRentHtml}
                     
                     ${isOwned ? `<div class="h-1 w-full rounded-full shadow-inner" style="background-color: ${ownerColor};"></div>` : '<div class="h-1 w-full"></div>'}
                     <div class="w-full h-10 relative"> ${playerTokensHtml}
                     </div>
             </div>
             `;
    }).join('');
    
    // NEW: 從這裡移除自動滾動邏輯。現在滾動只在 animateMove 中運行。
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function addLog(text, type = 'info') {
    const logElement = document.getElementById('game-log');
    // 此處只記錄日誌，實際渲染和樣式由 onSnapshot 處理
    // logElement.prepend(logItem); // 移除不必要的 DOM 操作
}

/**
 * 設置按鈕的啟用/禁用狀態
 */
function setControlState() {
    
    // --- NEW: 管理員/請求按鈕控制 (功能 1 & 2) ---
    const gameMaster = gameState ? gameState.players[0] : null;
    const isGameMasterDevice = gameMaster && gameMaster.currentUserId === userId;
    const existingPlayer = gameState ? gameState.players.find(p => p.currentUserId === userId) : null;
    const isAdminReady = gameMaster && gameMaster.currentUserId !== null; 
    
    // 功能 1: 只有 P0 控制者看到設定/管理按鈕
    const adminButtons = [document.getElementById('settings-btn'), document.getElementById('player-admin-btn')];
    // 修正：現在按鈕位於容器內，只需要控制按鈕的 `hidden` 屬性即可
    adminButtons.forEach(btn => btn.classList.toggle('hidden', !isGameMasterDevice));
    
    // NEW: Debug Input 顯示控制
    const debugInput = document.getElementById('debug-steps-input');
    if (debugInput) {
         debugInput.style.display = (isGameMasterDevice && gameState?.settings?.debugMode) ? 'block' : 'none';
    }


    // 功能 2: 浮動請求按鈕 (已禁用，鼓勵點擊卡片認領)
    document.getElementById('request-join-btn').classList.toggle('hidden', true); 
    
    // --- 遊戲中控制邏輯 ---

    if (!gameState || gameState.status === 'WIN' || !gameState.gameStarted) {
        document.getElementById('roll-dice-btn').disabled = true;
        document.getElementById('end-turn-btn').disabled = true;
        setControlVisibility('none');
        
        if (gameState && !gameState.gameStarted && gameState.players.filter(p => p.isPlaying).length > 0) {
            addLog('提示：遊戲人數不足 2 位。請前往「👤 玩家管理」設定人數並儲存以開始遊戲。', 'info');
        } else if (gameState && !gameState.gameStarted && gameState.players.filter(p => p.isPlaying).length === 0) {
            addLog('提示：正在等待遊戲初始化並認領您的玩家角色...', 'info');
        }
        
        // NEW: 確保初始骰子圖片顯示為 1, 1
        const dice1El = document.getElementById('dice-display-1');
        const dice2El = document.getElementById('dice-display-2');
        dice1El.src = DICE_IMAGES[gameState?.dice[0] || 1];
        dice2El.src = DICE_IMAGES[gameState?.dice[1] || 1];
        
        return; 
    }
    
    // --- 遊戲中控制邏輯 ---

    const currentPlayerIndex = gameState.turn;
    const currentPlayer = gameState.players[currentPlayerIndex];
    
    // 功能 5: 熱機模式判斷
    const isGameMasterDeviceChecker = gameState.players[0] && gameState.players[0].currentUserId === userId;
    const isHotSwapMode = gameState.settings?.hotSwapMode === true;
    let isMyTurn;
    if (isHotSwapMode && isGameMasterDeviceChecker) {
        // 熱機模式下，P0 設備可以控制任何輪到回合的玩家
        isMyTurn = true; 
    } else {
        // 線上模式/非 P0 設備：必須是自己綁定的角色
        isMyTurn = currentPlayer.currentUserId === userId; 
    }

    // [修正 1] 監獄服刑期間禁用擲骰
    const isInJailAndServing = currentPlayer.inJail && currentPlayer.jailTurns > 0;
    
    // --- 修正 2.1: MOVING 狀態時全部禁用 ---
    if (gameState.status === 'MOVING') {
        document.getElementById('roll-dice-btn').disabled = true;
        document.getElementById('end-turn-btn').disabled = true;
        setControlVisibility('none');
        return; 
    }
    // --- END 修正 2.1 ---
    
    // 【主要修正 1：解除卡住】
    // Roll Dice 按鈕啟用邏輯
    document.getElementById('roll-dice-btn').disabled = !(isMyTurn && gameState.status === 'READY' && currentPlayer.isPlaying && !isInJailAndServing); // 監獄服刑時 READY 狀態也禁用擲骰
    
    // End Turn 按鈕啟用邏輯
    // 監獄服刑期間允許結束回合（點擊監獄彈窗的確認按鈕會呼叫 endTurn）
    document.getElementById('end-turn-btn').disabled = !(isMyTurn && (gameState.status === 'ACTION_REQUIRED' || gameState.status === 'ROLLED' || isInJailAndServing) && currentPlayer.isPlaying);
    
    // NEW: 骰子圖片更新
    const dice1El = document.getElementById('dice-display-1');
    const dice2El = document.getElementById('dice-display-2');
    dice1El.src = DICE_IMAGES[gameState.dice[0]];
    dice2El.src = DICE_IMAGES[gameState.dice[1]];
    
    // 調整結束回合按鈕的顏色
    const endTurnBtn = document.getElementById('end-turn-btn');
    // 移除舊的顏色類別
    endTurnBtn.classList.remove('bg-indigo-700', 'hover:bg-indigo-800', 'bg-gray-600', 'hover:bg-gray-700');
    
    if (isMyTurn && (gameState.status === 'ACTION_REQUIRED' || gameState.status === 'ROLLED' || isInJailAndServing)) {
        // 如果需要動作或已經擲骰，則為亮色 (提示可點擊)
        endTurnBtn.classList.add('bg-indigo-700', 'hover:bg-indigo-800');
    } else {
        // 否則為暗色
        endTurnBtn.classList.add('bg-gray-600', 'hover:bg-gray-700');
    }


    // **NEW: 處理額外動作按鈕 (購買地產、陷害卡、地產管理)**
    const pendingType = gameState.pendingAction?.type;
    
    if (!isMyTurn) {
        setControlVisibility('none'); // 無主按鈕
    } else if (gameState.status === 'ACTION_REQUIRED') {
        const currentSquare = gameState.board[currentPlayer.position];
        const squareType = currentSquare.type;
        
        // 必須是 ACTION_REQUIRED，且停在 BANK 或 CASINO 才能使用
        if (squareType === 'BANK' && pendingType === 'BANK_SERVICE') {
            setControlVisibility('bank');
        } else if (squareType === 'CASINO' && pendingType === 'CASINO_GAME') {
            setControlVisibility('casino');
        } else if (squareType === 'PROPERTY' && currentSquare.owner !== null && currentSquare.owner !== currentPlayer.id && !currentSquare.mortgage) {
            // 處於付租金的 ACTION_REQUIRED 狀態，不顯示其他按鈕
            setControlVisibility('none');
        } else {
            setControlVisibility('none');
        }
    } else if (pendingType === 'BUY_PROPERTY') {
        // 如果是 ROLLED 狀態，但有待處理的購買動作（踩到無主地產後）
        setControlVisibility('buy'); 
    } else if (pendingType === 'PROPERTY_MANAGEMENT') {
        // 如果是 ROLLED 狀態，但有待處理的地產管理動作（踩到自己的地產後）
        setControlVisibility('manage'); 
    } else if (pendingType === 'USE_TRAP_CARD') {
        // 如果是 ROLLED 狀態，但有待處理的陷害卡動作（抽到陷害卡後）
        setControlVisibility('trap');
    } else {
        setControlVisibility('none');
    }
}

// **NEW: 擴展 setControlVisibility 函數以包含 buy, trap, manage**
function setControlVisibility(action) {
     // 確保這裡包含了所有控制按鈕的 ID
     const controls = ['bank', 'casino', 'buy', 'trap', 'manage']; 
     controls.forEach(c => {
         let btnId;
         if (c === 'buy') btnId = 'buy-property-btn';
         else if (c === 'trap') btnId = 'use-trap-card-btn';
         else if (c === 'manage') btnId = 'manage-property-btn';
         else if (c === 'bank') btnId = 'bank-btn';
         else if (c === 'casino') btnId = 'casino-btn';
         
         const btn = document.getElementById(btnId);
         if (btn) {
             if (c === action) {
                  btn.classList.remove('hidden');
                  btn.disabled = false;
             } else {
                  btn.classList.add('hidden');
                  btn.disabled = true;
             }
         }
     });
}
// **END NEW**

async function retryFirestoreOperation(operation, maxRetries = 5) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
             return await operation();
        } catch (error) {
             if (error.code && (error.code === 'permission-denied' || error.message.includes('Missing or insufficient permissions'))) {
                  console.warn(`Firestore 權限不足，第 ${attempt + 1} 次重試...`, error.message);
             } else if (error.message.includes("Document not found")) {
                  throw error;
             } else {
                  console.warn(`Firestore 操作失敗，第 ${attempt + 1} 次重試...`, error.message);
             }
             
             if (attempt === maxRetries - 1) {
                  throw error;
             }
             const delay = Math.pow(2, attempt) * 1000;
             await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

async function restartGame() {
    const savedSettings = gameState.settings;
    const oldPlayers = gameState.players;

    // === 關鍵：強制重新生成 BOARD，讓你的 intervalSpecialIndices 修改真正生效 ===
    // 這會重新執行整個棋盤生成邏輯（包含特殊格位置分配 + 地產隨機打亂）
    const freshInitialState = getInitialGameState(savedSettings.initialMoney);

    // === 步驟1：取出剛生成的 board，準備只打亂地產格 ===
    let newBoard = JSON.parse(JSON.stringify(freshInitialState.board)); // 深拷貝新生成的棋盤

// 取出所有地產格
const propertySquares = newBoard.filter(sq => sq.type === 'PROPERTY');
// 洗牌地產格順序（Fisher-Yates）
for (let i = propertySquares.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [propertySquares[i], propertySquares[j]] = [propertySquares[j], propertySquares[i]];
}
// 重建棋盤：特殊格位置不變，地產格用洗牌後的順序填回去
let propIndex = 0;
newBoard = newBoard.map((square, i) => { // ← 新增 i 參數（位置索引）
    if (square.type === 'PROPERTY') {
const prop = propertySquares[propIndex++]; // 取出洗牌後的地產
return { ...prop, index: i }; // ← 關鍵：強制設置新 index = i
    }
    return { ...square, index: i }; // ← 特殊格也更新 index（保險）
});

    // === 步驟2：建立最終的 initialGameState ===
    const initialGameState = getInitialGameState(savedSettings.initialMoney);

    // 使用我們剛剛「特殊格依新設定 + 地產已洗牌」的棋盤
    initialGameState.board = newBoard;

    // 完整保留所有設定（圖片、簡介、股票等）
    initialGameState.settings = JSON.parse(JSON.stringify(savedSettings)); // 深拷貝確保不影響舊的

    // 保留玩家名稱、顏色、頭像，但重置遊戲進度
    initialGameState.players = initialGameState.players.map((p, index) => {
const oldP = oldPlayers[index] || p;
return {
    ...p,
    name: oldP.name,
    color: oldP.color,
    avatarUrl: oldP.avatarUrl,
    isPlaying: index === 0,			// 只啟用 P0
    currentUserId: null,			// 全部解除綁定
    money: savedSettings.initialMoney,
    bank: 0,
    stocks: { ...p.stocks },		// 重置持股為 0
    position: 0,
    inJail: false,
    jailTurns: 0,
    properties: [],
    lastActiveTimestamp: Date.now(),
    trapCard: null, // **NEW: 重置陷害卡**
};
    });

    // 強制將 P0 綁定給重啟遊戲的人
    if (initialGameState.players[0]) {
initialGameState.players[0].currentUserId = userId;
initialGameState.players[0].isPlaying = true;
initialGameState.turn = 0;
    }

    // 其他狀態重置
    initialGameState.gameStarted = false;
    initialGameState.status = 'READY';
    initialGameState.pendingJoinRequests = {};
    initialGameState.pendingAction = { type: 'none', squareIndex: null, card: null }; // **NEW: 清除 pendingAction**
    initialGameState.round = 1; // **NEW: 重置回合數**

    // 股票價格：保留當前波動後的價格（可改成重置的話把這行改掉）
    initialGameState.currentStocks = gameState.currentStocks.map(s => ({
...s,
sellPrice: Math.floor(s.price * 0.8)
    }));

    // 日誌提示
    initialGameState.log = [{
text: `遊戲已重新啟動！特殊格已依最新設定重新配置，地產顯示順序已隨機重排，所有圖片與簡介都完整保留。`,
time: Date.now()
    }];

    // 寫入 Firestore
    await updateGameState(initialGameState, '遊戲重啟成功，新棋盤已生成');

    // 關閉確認視窗
    document.getElementById('modal').classList.add('hidden');
    document.getElementById('modal').classList.remove('flex');
}
function showModal(title, message, confirmAction, contentHtml = null, confirmText = '確認') {
    document.getElementById('modal-message').innerHTML = message;
    const modalContent = document.getElementById('modal-content');
    modalContent.innerHTML = contentHtml || '';
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');
    const topCloseBtn = document.getElementById('modal-top-close-btn');

    // 標題只接受純文字，避免玩家名稱或同步資料被當成 HTML 執行
    document.getElementById('modal-title').textContent = title; 

    // 【UI/UX 修正】重置取消按鈕的文字，避免從 Casino 彈窗繼承「離開賭場」
    cancelBtn.textContent = '取消'; 
    
    confirmBtn.textContent = confirmText;
    
    // 處理確認按鈕的點擊事件
    const closeAndReset = () => {
        document.getElementById('modal').classList.add('hidden');
        document.getElementById('modal').classList.remove('flex');
        // 重設確認按鈕樣式，確保買不起時的樣式不會殘留
        confirmBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
        confirmBtn.classList.remove('bg-gray-400', 'hover:bg-gray-500');
    };
    
    // 處理頂部關閉按鈕
    topCloseBtn.onclick = closeAndReset;

    if (confirmText === '關閉' || confirmText === '開始遊戲') {
        confirmBtn.onclick = closeAndReset;
        cancelBtn.classList.add('hidden');
    } else {
        confirmBtn.onclick = () => {
            // 先執行 Action，再關閉 Modal
            confirmAction();
            closeAndReset(); // 如果 Action 成功，則關閉
        };
    }

    // 處理取消按鈕的可見性和行為
    const isPersistentModal = title.includes('確認重新啟動遊戲') || title.includes('玩家管理') || title.includes('設定') || title.includes('認領角色請求') || title.includes('支付過路費確認') || title.includes('選擇陷害目標') || title.includes('購買地產') || title.includes('銀行服務') || title.includes('地產簡介') || title.includes('監獄狀態提示') || title.includes('地產管理') || title.includes('繳納稅款') || title.includes('Casino');

    if (isPersistentModal) {
         if (title.includes('支付過路費確認') || title.includes('監獄狀態提示') || title.includes('管理員接管成功') || title.includes('繳納稅款')) {
              // 對於支付、監獄和稅務彈窗，不允許取消
              cancelBtn.classList.add('hidden');
         } else {
              cancelBtn.classList.remove('hidden');
         }
         
         // 對於地產購買和陷害卡，取消按鈕在各自的 Modal 函式中被覆寫了行為
         if (!title.includes('購買地產') && !title.includes('選擇陷害目標') && !title.includes('Casino') && !title.includes('地產管理') && !title.includes('銀行服務')) {
              cancelBtn.onclick = closeAndReset;
         }
    } else if (title.includes('Casino')) {
         // Casino 邏輯在 showCasinoModal 中單獨處理
    } else {
         cancelBtn.classList.add('hidden');
    }
    
    // 確保非 Casino 模態視窗的頂部關閉按鈕永遠存在
    topCloseBtn.classList.remove('hidden');


    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('modal').classList.add('flex');
}

async function listenForGameState() {
    gameRef = doc(db, `artifacts/${appId}/public/data/melbourne_monopoly`, 'game_master');
    console.log(`[${userId}] Using gameRef path: ${gameRef.path}`);

    let shouldInitialize = false;
    let docExists = false;
    try {
await retryFirestoreOperation(async () => {
    const docSnapshot = await getDoc(gameRef);
    if (!docSnapshot.exists()) {
        shouldInitialize = true;
        throw new Error("Game document needs initialization.");
    }
    docExists = true;
}, 5);

    } catch (error) {
if (error.message.includes("Game document needs initialization")) {
    shouldInitialize = true;
    console.log(`[${userId}] 遊戲文件不存在，將嘗試初始化。`);
} else {
    console.error(`[${userId}] 初始讀取時遇到嚴重錯誤：`, error);
    addLog(`初始讀取失敗：無法確認遊戲狀態 (${error.message})`, 'error');
    return;
}
    }

    if (shouldInitialize && !docExists) {
try {
    console.log(`[${userId}] 嘗試創建新的公共遊戲實例。`);
    const initialGameState = getInitialGameState(DEFAULT_INITIAL_MONEY);

    initialGameState.gameStarted = false;
    initialGameState.status = 'READY';

    if (initialGameState.players[0]) {
        initialGameState.players[0].currentUserId = userId;
        initialGameState.players[0].isPlaying = true;
    }
    await retryFirestoreOperation(async () => {
        await setDoc(gameRef, initialGameState);
    }, 5);

    console.log(`[${userId}] 成功創建新文件並初始化遊戲狀態。`);
} catch (writeError) {
    console.error(`[${userId}] 寫入新文件失敗，無法啟動遊戲：`, writeError);
    addLog(`初始化失敗：無法寫入數據庫，請檢查您的 Firestore 權限。`, 'error');
    return;
}
    }

    // 設置監聽器
    onSnapshot(gameRef, (doc) => {
if (doc.exists()) {
    const newGameState = doc.data();

     // --- 【核心修正：MOVING 狀態重連恢復邏輯】 ---
if (newGameState.status === 'MOVING') {
    const currentPlayerIndex = newGameState.turn;
    const currentPlayer = newGameState.players[currentPlayerIndex];
    
    // 判斷是否為自己的回合 (考慮熱機模式)
    const isGameMasterDevice = newGameState.players[0]?.currentUserId === userId;
    const isHotSwapMode = newGameState.settings?.hotSwapMode === true;
    const isMyTurn = (isHotSwapMode && isGameMasterDevice) || (currentPlayer.currentUserId === userId);

    // 如果是我輪到，且狀態是 MOVING，代表我剛重整進來，動畫沒跑完
    if (isMyTurn && !isProcessingAction) {
        console.log("偵測到移動中重整，正在恢復該格的功能視窗...");
        isProcessingAction = true; // 防止重複觸發

        // 延遲一下確保數據載入完畢
        setTimeout(async () => {
            gameState = newGameState; // 更新本地狀態
            // 直接觸發落地邏輯：這會根據玩家當前位置彈出「購買」、「租金」或「卡片」視窗
            await handleLandingAction(currentPlayerIndex);
            isProcessingAction = false;
        }, 800);
        return;
    }
}
// --- 【修復結束】 ---
    
    
    // --- 確保 currentStocks 與 stocksConfig 同步（新增股票時自動初始化價格）---
    let needsStockUpdate = false;
    const stocksConfig = newGameState.settings.stocksConfig || [];
    const currentStocks = newGameState.currentStocks || [];

    const updatedCurrentStocks = [...currentStocks];
    stocksConfig.forEach(configStock => {
        const existingDynamicStock = currentStocks.find(s => s.symbol === configStock.symbol);

        if (!existingDynamicStock) {
            console.log(`[${userId}] 偵測到新股票：${configStock.symbol}，正在初始化動態價格。`);
            updatedCurrentStocks.push({
                name: configStock.name,
                symbol: configStock.symbol,
                price: configStock.price,
                sellPrice: Math.floor(configStock.price * 0.8),
                volatility: configStock.volatility || DEFAULT_VOLATILITY,
            });
            needsStockUpdate = true;
        }
    });
    if (needsStockUpdate) {
        console.log(`[${userId}] stocksConfig/currentStocks 不一致，強制同步。`);
        newGameState.currentStocks = updatedCurrentStocks;
        setDoc(gameRef, { ...newGameState, log: newGameState.log });
    }
    // --- 結束同步 ---

    // --- 檢查加入/被踢出提示 ---
    if (previousPlayersState) {
        const myPlayer = newGameState.players.find(p => p.currentUserId === userId);
        const oldBoundPlayer = previousPlayersState.find(p => p.currentUserId === userId);

        if (myPlayer && (!oldBoundPlayer || oldBoundPlayer.id !== myPlayer.id)) {
            const wasPending = gameState.pendingJoinRequests ? Object.keys(gameState.pendingJoinRequests).includes(userId) : false;
            if (wasPending || !oldBoundPlayer) {
                showModal(
                    '✅ 成功加入遊戲',
                    `<p class="text-lg">恭喜您，您現在是 **${myPlayer.name}**！請等待您的回合開始。</p>`,
                    () => {},
                    null,
                    '開始遊戲'
                );
            }
        }

        const amIBoundNow = newGameState.players.some(p => p.currentUserId === userId);
        if (oldBoundPlayer && !amIBoundNow) {
            showModal(
                '⚠️ 角色綁定已解除',
                `<p class="text-lg text-red-600 font-bold">您對角色 **${oldBoundPlayer.name}** 的控制權已被遊戲管理員解除。</p><p class="mt-2 text-sm">您可以點擊其他空閒卡片重新請求加入。</p>`,
                () => {},
                null,
                '確認'
            );
        }
    }
    previousPlayersState = JSON.parse(JSON.stringify(newGameState.players));
    gameState = newGameState;

    // 恢復儲存的圖片 URL
    if (gameState.settings && gameState.settings.propertyImageUrls) {
        const savedImageUrls = gameState.settings.propertyImageUrls;
        gameState.board = gameState.board.map(square => {
            if (square.type === 'PROPERTY' && savedImageUrls[square.name]) {
                return { ...square, imageUrl: savedImageUrls[square.name] };
            }
            return square;
        });
    }

    // P0 自動認領（僅首次）
    claimPlayerSlot(false);

    renderPlayerStats();
    renderBoardDisplay();

    // === 終極自動恢復機制：重新整理後 ACTION_REQUIRED/ROLLED 時強制彈出必要視窗 ===
    // **關鍵修正：新增對 BUY_PROPERTY 和 USE_TRAP_CARD 的處理**
    if (gameState.status === 'ACTION_REQUIRED' || gameState.status === 'ROLLED' || gameState.status === 'READY') {
        const currentPlayerIndex = gameState.turn;
        const currentPlayer = gameState.players[currentPlayerIndex];

        const isGameMasterDevice = gameState.players[0]?.currentUserId === userId;
        const isHotSwapMode = gameState.settings?.hotSwapMode === true;
        const isMyTurn = (isHotSwapMode && isGameMasterDevice) || (currentPlayer.currentUserId === userId);
        const isModalOpen = document.getElementById('modal').classList.contains('flex') || document.getElementById('card-modal').classList.contains('flex');

        // 【修改後】：加入 !isProcessingAction 判斷
        if (isMyTurn && !isModalOpen && !isRestoringModal && !isProcessingAction) {
            const currentSquare = gameState.board[currentPlayer.position];
            const pendingType = gameState.pendingAction?.type;
            isRestoringModal = true; 
            
            // 1. 他人物產 (租金支付)
            if (gameState.status === 'ACTION_REQUIRED' && currentSquare.type === 'PROPERTY' && currentSquare.owner !== null && currentSquare.owner !== currentPlayer.id) {
                const ownerPlayer = gameState.players.find(p => p.id === currentSquare.owner);
                const rent = calculateRent(currentSquare);
                // 重新彈出租金支付視窗
                showRentModal(currentPlayer, ownerPlayer, currentSquare, rent);
                addLog(`[自動恢復] 偵測到他人物產「${currentSquare.name}」，租金支付視窗已強制重新彈出！`, 'info');
            }
            // 2. 監獄跳過回合提示 (Jail Turn)
            // 【**修正**：處理監獄彈窗的自動恢復，確保 jailTurns > 0 時彈出】
            // 只有在 READY 狀態下，且確定在監獄中但沒有擲骰動作（剛輪到或刷新頁面）才彈出
            else if (gameState.status === 'READY' && currentPlayer.inJail && currentPlayer.jailTurns > 0) {
                // 這裡在 onSnapshot 檢查並彈出模態，讓玩家點擊「確認」來走完監獄流程
                // rollDice 裡面的邏輯會處理狀態轉移和 jailTurns 減少
                showJailTurnModal(currentPlayer, currentPlayer.jailTurns);
                addLog(`[自動恢復] 偵測到監獄服刑中，監獄提示視窗已強制重新彈出！`, 'info');
            }
            // 2.5 稅務支付 (新增)
            else if (gameState.status === 'ACTION_REQUIRED' && (currentSquare.type === 'INCOME_TAX' || currentSquare.type === 'LUXURY_TAX')) {
                 const taxAmount = currentSquare.type === 'INCOME_TAX' ? Math.round(currentPlayer.money * currentSquare.action) : currentSquare.action;
                 showTaxModal(currentPlayer, currentSquare, taxAmount);
                 addLog(`[自動恢復] 偵測到稅務支付未完成，稅務彈窗已強制重新彈出！`, 'info');
            }
            // 3. 無主地產
            else if (pendingType === 'BUY_PROPERTY') {
                showPropertyBuyModal(currentPlayer, currentSquare);
                addLog(`[自動恢復] 偵測到無主地產「${currentSquare.name}」，購買視窗已強制重新彈出！`, 'info');
            }
            // 4. 陷害卡
            else if (pendingType === 'USE_TRAP_CARD' && currentPlayer.trapCard !== null) {
                showTrapTargetModal(currentPlayer, currentPlayer.trapCard);
                addLog(`[自動恢復] 偵測到陷害卡，目標選擇視窗已強制重新彈出！`, 'info');
            }
            // 5. 銀行服務（新增）
            else if (pendingType === 'BANK_SERVICE') {
                showBankModal(currentPlayer);
                addLog(`[自動恢復] 偵測到銀行服務未完成，銀行彈窗已強制重新彈出！`, 'info');
            }
            // 6. Casino（新增）
            else if (pendingType === 'CASINO_GAME') {
                showCasinoModal(currentPlayer);
                addLog(`[自動恢復] 偵測到 Casino 未完成，Casino 彈窗已強制重新彈出！`, 'info');
            }
            // 7. 地產管理（新增）
            else if (pendingType === 'PROPERTY_MANAGEMENT') {
                showPropertyManagementModal(currentPlayer, currentSquare);
                addLog(`[自動恢復] 偵測到地產管理未完成，地產管理彈窗已強制重新彈出！`, 'info');
            }
            // 一秒後解鎖，避免短時間內重複觸發
            setTimeout(() => { isRestoringModal = false; }, 1000);
        }
    }

    // === 終極保險：如果 ACTION_REQUIRED 但沒有任何視窗，顯示紅色強制結束回合按鈕 ===
    if (gameState.status === 'ACTION_REQUIRED' || gameState.pendingAction?.type === 'BUY_PROPERTY' || gameState.pendingAction?.type === 'USE_TRAP_CARD' || gameState.pendingAction?.type === 'PROPERTY_MANAGEMENT' || gameState.pendingAction?.type === 'BANK_SERVICE' || gameState.pendingAction?.type === 'CASINO_GAME') {
        const currentPlayerIndex = gameState.turn;
        const currentPlayer = gameState.players[currentPlayerIndex];

        const isGameMasterDevice = gameState.players[0]?.currentUserId === userId;
        const isHotSwapMode = gameState.settings?.hotSwapMode === true;
        const isMyTurn = (isHotSwapMode && isGameMasterDevice) || (currentPlayer.currentUserId === userId);
        const modalVisible = document.getElementById('modal').classList.contains('flex');
        const cardModalVisible = document.getElementById('card-modal').classList.contains('flex');

        // 檢查是否所有必要的 Action 都沒有彈窗，且不是在處理 Rent/Jail/Card 必須等待的狀態
        const isStuck = isMyTurn && !modalVisible && !cardModalVisible && gameState.status !== 'MOVING';
        
        // 排除不需要強制結束的狀況：
        // 只有當 action 是租金時，才不允許強制結束，因為租金 Modal 不允許關閉。
        const isRentRequired = gameState.status === 'ACTION_REQUIRED' && gameState.board[currentPlayer.position].type === 'PROPERTY' && gameState.board[currentPlayer.position].owner !== null && gameState.board[currentPlayer.position].owner !== currentPlayer.id && !gameState.board[currentPlayer.position].mortgage;

        if (isStuck && !isRentRequired) {
            let forceBtn = document.getElementById('force-end-turn-btn');
            if (!forceBtn) {
                const controlsArea = document.getElementById('game-controls-emergency-area'); // 修正：使用新增的區域
                forceBtn = document.createElement('button');
                forceBtn.id = 'force-end-turn-btn';
                forceBtn.textContent = '🚨 強制結束回合 (卡住救急)';
                forceBtn.className = 'bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-xl shadow-2xl transition-all duration-200 text-base w-full md:w-auto mx-auto mb-4 border-4 border-red-400 animate-pulse';
                forceBtn.onclick = async () => {
                    const currentSquare = gameState.board[currentPlayer.position];
                    // **NEW: 清除所有 pendingAction 和 trapCard**
                    currentPlayer.trapCard = null;
                    const logMsg = `${currentPlayer.name} 使用「強制結束回合」脫困（相當於放棄當前動作）。`;
                    await updateGameState({ ...gameState, status: 'ROLLED', pendingAction: { type: 'none', squareIndex: null, card: null } }, logMsg);
                    await endTurn();
                    forceBtn.remove();
                };
                // 將按鈕插入到 controlsArea 的底部
                controlsArea.appendChild(forceBtn);
                addLog(`🚨 回合似乎卡住！已出現紅色「強制結束回合」按鈕，點擊即可繼續遊戲（等同放棄當前動作）。`, 'error');
            }
        } else {
            const existingForceBtn = document.getElementById('force-end-turn-btn');
            if (existingForceBtn) existingForceBtn.remove();
        }
    } else {
        const existingForceBtn = document.getElementById('force-end-turn-btn');
        if (existingForceBtn) existingForceBtn.remove();
    }
    // === 終極保險結束 ===

    setControlState();
    renderHeaderAlerts();

    // 日誌渲染（最新在上，紅色高亮）
    const logElement = document.getElementById('game-log');
    logElement.innerHTML = gameState.log.map((item, index) => {
        const isNewest = index === 0;
        const colorClass = isNewest ? 'text-red-600 font-bold' : 'text-gray-700';
        return `<li class="${colorClass} text-sm">${escapeHtml(item.text)}</li>`;
    }).join('');
} else {
    console.warn('遊戲文件已被刪除或不存在!');
    addLog('警告：遊戲文件已被刪除或無法訪問，請重啟網頁或檢查權限。', 'error');
}
    }, (error) => {
console.error(`[${userId}] onSnapshot 監聽失敗 (Firebase 錯誤)：`, error);
addLog(`數據同步失敗：${error.message}，請檢查您的網路連線或權限設定。`, 'error');
    });
}

async function initializeFirebase() {
    if (!firebaseConfig) {
        console.error('Firebase 配置缺失!');
        document.getElementById('user-id-display').textContent = '錯誤: Firebase 配置缺失';
        return;
    }

    try {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }
        
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                // 顯示當前用戶 ID 的前 8 位以供參考
                document.getElementById('user-id-display').textContent = `${userId.substring(0, 8)}... (您的 ID)`;
                if (!isListenerInitialized) {
                    listenForGameState();
                    isListenerInitialized = true;
                }
            } else {
                console.log('未登入');
                userId = 'loading';
                isListenerInitialized = false; 
                document.getElementById('user-id-display').textContent = '未認證';
            }
        });
        
        // --- 遊戲標題隱藏功能監聽器 (重新啟用) ---
        document.getElementById('game-title').addEventListener('click', () => {
            const currentTime = Date.now();
            
            if (currentTime - lastClickTime < CLICK_THRESHOLD) {
                clickCount++;
            } else {
                clickCount = 1;
            }

            lastClickTime = currentTime;

            if (clickCount === 3) {
                console.log('Triple click detected, attempting admin takeover...');
                clickCount = 0; // Reset immediately
                forceAdminTakeover(); 
            }
        });


        // --- 遊戲控制按鈕監聽器 ---
        // 由於 endTurn 和 rollDice 已經被移至頂層作用域，現在應該可以被正確引用
        document.getElementById('roll-dice-btn').addEventListener('click', rollDice);
        document.getElementById('end-turn-btn').addEventListener('click', endTurn);
        
        // **NEW: 綁定購買地產、地產管理和陷害卡按鈕**
        document.getElementById('buy-property-btn').addEventListener('click', window.showPropertyBuyModalWrapper);
        document.getElementById('manage-property-btn').addEventListener('click', window.showPropertyManagementModalWrapper);
        document.getElementById('use-trap-card-btn').addEventListener('click', window.showTrapTargetModalWrapper);
        
        document.getElementById('settings-btn').addEventListener('click', () => {
            if (!gameState) { addLog("遊戲狀態尚未載入，請稍候。", 'error'); return; }
            showSettingsModal();
        }); 
        document.getElementById('player-admin-btn').addEventListener('click', () => {
            if (!gameState) { addLog("遊戲狀態尚未載入，請稍候。", 'error'); return; }
            showPlayerAdminModal();
        }); 
        
        document.getElementById('casino-btn').addEventListener('click', () => {
             const currentPlayer = gameState.players[gameState.turn];
             if(gameState.status === 'ROLLED' && gameState.board[currentPlayer.position].type === 'CASINO'){
                  showCasinoModal(currentPlayer);
             } else {
                  addLog('錯誤: 現在不是進行 Casino 操作的時機。', 'error');
             }
         });

        document.getElementById('bank-btn').addEventListener('click', () => {
             const currentPlayer = gameState.players[gameState.turn];
             if(gameState.status === 'ROLLED' && gameState.board[currentPlayer.position].type === 'BANK'){ 
                  showBankModal(currentPlayer);
             } else {
                  addLog('錯誤: 現在不是進行銀行操作的時機。', 'error');
             }
         });
        
        // NEW: 浮動按鈕綁定 (由於卡片點擊已實現，此按鈕功能被弱化，只在有可認領槽位時作為提醒)
        document.getElementById('request-join-btn').addEventListener('click', () => {
              const unclaimedSlot = gameState?.players?.find(p => p.id !== 'p0' && p.isPlaying && p.currentUserId === null);
              
              if (unclaimedSlot) {
                      // 彈出一個選角提示，鼓勵點擊卡片
                      showModal(
                           '🔗 選擇一個角色加入',
                           `<p class="text-lg">請直接點擊上方資訊面板中，<span class="text-green-600 font-bold">邊框為綠色</span> 且 <span class="text-gray-500 font-semibold">控制資訊顯示「無主 (可認領)」</span> 的玩家資訊卡，以發起認領請求。</p>`,
                           () => {},
                           null,
                           '確認'
                         );
              } else {
                          addLog('目前沒有可認領的玩家角色。請管理員在「玩家管理」中啟用新的角色。', 'error');
              }
          });


    } catch (e) {
        console.error('Firebase/Auth 初始化失敗:', e);
        document.getElementById('user-id-display').textContent = '錯誤: 初始化失敗';
    }
}

window.onload = initializeFirebase;
