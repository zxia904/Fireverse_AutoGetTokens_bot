const axios = require('axios');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const ethers = require('ethers');
const readline = require('readline');
const banner = require('./banner.js');

console.log(banner);

const API_BASE_URL = 'https://api.fireverseai.com';
const WEB3_URL = 'https://web3.fireverseai.com';
const APP_URL = 'https://app.fireverseai.com';

const DEFAULT_HEADERS = {
    'accept': 'application/json',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'accept-language': 'en-US,en;q=0.9',
    'origin': WEB3_URL,
    'referer': `${WEB3_URL}/`,
    'sec-ch-ua': '"Not(A:Brand";v="99", "Microsoft Edge";v="133", "Chromium";v="133"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

// 读取钱包私钥文件
async function loadWallets() {
    try {
        const walletsPath = path.join(__dirname, 'wallets.txt');
        if (fsSync.existsSync(walletsPath)) {
            const content = await fs.readFile(walletsPath, 'utf8');
            const privateKeys = content.split('\n')
                .map(line => line.trim())
                .filter(line => line && line.startsWith('0x'));
            
            console.log(`📝 从wallets.txt加载了${privateKeys.length}个私钥`);
            return privateKeys;
        } else {
            console.log('⚠️ wallets.txt文件不存在，请创建该文件并添加私钥（每行一个，以0x开头）');
            return [];
        }
    } catch (error) {
        console.log('⚠️ 加载钱包文件出错:', error.message);
        return [];
    }
}

// 保存token到文件
async function saveTokens(tokensData) {
    try {
        const tokensPath = path.join(__dirname, 'tokens.txt');
        
        // 只保存token值，每行一个
        let content = tokensData.map(data => data.token).join('\n');
        
        await fs.writeFile(tokensPath, content);
        console.log(`💾 已将${tokensData.length}个token保存到tokens.txt`);
    } catch (error) {
        console.log('⚠️ 保存token文件出错:', error.message);
    }
}

async function getSession(axiosInstance) {
    try {
        const response = await axiosInstance.get(`${API_BASE_URL}/walletConnect/getSession`);
        return response.data.data;
    } catch (error) {
        console.error('❌ 获取会话失败:', error.message);
        return null;
    }
}

async function getNonce(axiosInstance) {
    try {
        const response = await axiosInstance.get(`${API_BASE_URL}/walletConnect/nonce`);
        return response.data.data.nonce;
    } catch (error) {
        console.error('❌ 获取nonce失败:', error.message);
        return null;
    }
}

async function signMessage(wallet, nonce) {
    const messageToSign = `web3.fireverseai.com wants you to sign in with your Ethereum account:\n${wallet.address}\n\nPlease sign with your account\n\nURI: https://web3.fireverseai.com\nVersion: 1\nChain ID: 8453\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
    
    const signingKey = new ethers.SigningKey(wallet.privateKey);
    const messageHash = ethers.hashMessage(messageToSign);
    const signature = signingKey.sign(messageHash);
    
    return {
        message: messageToSign,
        signature: signature.serialized
    };
}

async function verifyWallet(axiosInstance, message, signature, inviteCode) {
    try {
        const response = await axiosInstance.post(
            `${API_BASE_URL}/walletConnect/verify`,
            {
                message,
                signature,
                wallet: "bee",
                invitationCode: inviteCode
            }
        );
        return response.data;
    } catch (error) {
        console.error('❌ 验证钱包失败:', error.message);
        return null;
    }
}

async function getTokenFromPrivateKey(privateKey, inviteCode = "fireverse", index, total) {
    try {
        console.log(`\n🔄 处理钱包 ${index + 1}/${total}`);
        
        // 从私钥创建钱包
        const wallet = new ethers.Wallet(privateKey);
        console.log('📝 钱包地址:', wallet.address);
        
        const axiosInstance = axios.create({
            timeout: 30000,
            headers: DEFAULT_HEADERS
        });
        
        // 获取会话
        const session = await getSession(axiosInstance);
        if (!session) {
            console.log('❌ 获取会话失败');
            return null;
        }
        console.log('✅ 会话ID:', session.sessionId);
        
        // 获取nonce
        const nonce = await getNonce(axiosInstance);
        if (!nonce) {
            console.log('❌ 获取nonce失败');
            return null;
        }
        console.log('✅ 获取nonce成功');
        
        // 签名消息
        const { message, signature } = await signMessage({ address: wallet.address, privateKey }, nonce);
        console.log('✅ 消息签名成功');
        
        // 验证钱包
        const verifyResult = await verifyWallet(axiosInstance, message, signature, inviteCode);
        
        if (verifyResult?.success) {
            const token = verifyResult.data.token;
            console.log('🎉 验证成功! 已获取token');
            
            return {
                address: wallet.address,
                token: token,
                sessionId: session.sessionId
            };
        } else {
            console.log('❌ 钱包验证失败');
            return null;
        }
    } catch (error) {
        console.error('❌ 处理过程中出错:', error.message);
        return null;
    }
}

// 获取所有token
async function getAllTokens() {
    console.log('🔐 更新了Fireverse Token 批量自动获取 🔐');
    console.log('-----------------------------------------------------');
    
    // 加载钱包私钥
    const privateKeys = await loadWallets();
    if (privateKeys.length === 0) {
        console.log('❌ 没有找到有效的私钥，请检查wallets.txt文件');
        process.exit(1);
    }
    
    const inviteCode = await question('请输入邀请码 (默认为"wanfeng"): ') || "wanfeng";
    
    console.log(`\n🔄 开始处理${privateKeys.length}个钱包...`);
    
    const tokensData = [];
    let successCount = 0;
    
    for (let i = 0; i < privateKeys.length; i++) {
        const result = await getTokenFromPrivateKey(privateKeys[i], inviteCode, i, privateKeys.length);
        
        if (result) {
            tokensData.push(result);
            successCount++;
        }
        
        if (i < privateKeys.length - 1) {
            console.log('\n⏳ 等待3秒后处理下一个钱包...');
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    
    // 保存tokens到文件
    if (tokensData.length > 0) {
        await saveTokens(tokensData);
    }
    
    console.log(`\n✨ 完成! 成功获取了 ${successCount}/${privateKeys.length} 个token`);
    return tokensData.length > 0;
}

class FireverseMusicBot {
    constructor(privateKey, accountIndex, inviteCode = "wanfeng") {
        this.baseUrl = API_BASE_URL;
        this.token = null;
        this.accountIndex = accountIndex;
        this.privateKey = privateKey;
        this.inviteCode = inviteCode;
        this.playedSongs = new Set();
        this.dailyPlayCount = 0;
        this.DAILY_LIMIT = 50;
        this.lastHeartbeat = Date.now();
        this.totalListeningTime = 0;
        this.headers = {
            'accept': '*/*',
            'accept-language': 'en-US,en;q=0.8',
            'content-type': 'application/json',
            'origin': APP_URL,
            'referer': `${APP_URL}/`,
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
            'x-version': '1.0.100',
            'sec-ch-ua': '"Not(A:Brand";v="99", "Brave";v="133", "Chromium";v="133"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'sec-gpc': '1',
            'token': null
        };
    }
    log(message, overwrite = false) {
        const prefix = `[账号 ${this.accountIndex}] `;
        if (overwrite) {
            process.stdout.write(`\r${prefix}${message}`);
        } else {
            console.log(`${prefix}${message}`);
        }
    }

    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    async initialize() {
        try {
            // 先获取token
            const tokenSuccess = await this.refreshToken();
            if (!tokenSuccess) {
                this.log('❌ 无法获取token，初始化失败');
                return false;
            }
            
            await this.getUserInfo();
            await this.getDailyTasks();
            return true;
        } catch (error) {
            this.log('❌ 初始化机器人出错: ' + error.message);
            return false;
        }
    }

    async getUserInfo() {
        try {
            const response = await axios.get(
                `${this.baseUrl}/userInfo/getMyInfo`,
                { headers: this.headers }
            );
            const { level, expValue, score, nextLevelExpValue } = response.data.data;
            this.log('\n📊 用户状态:');
            this.log(`等级: ${level} | 经验值: ${expValue}/${nextLevelExpValue} | 积分: ${score}`);
            this.log(`总收听时间: ${Math.floor(this.totalListeningTime / 60)} 分钟\n`);
        } catch (error) {
            this.log('❌ 获取用户信息出错: ' + error.message);
        }
    }

    async getDailyTasks() {
        try {
            const response = await axios.get(
                `${this.baseUrl}/musicTask/getListByCategory?taskCategory=1`,
                { headers: this.headers }
            );
            
            if (response.data?.data && Array.isArray(response.data.data)) {
                this.log('\n📋 每日任务:');
                response.data.data.forEach(task => {
                    if (task && task.name) {
                        let progress;
                        if (task.taskKey === 'play_music' && task.unit === 'minutes') {
                            progress = `${Math.floor(this.totalListeningTime / 60)}/${task.completeNum}`;
                        } else {
                            progress = task.itemCount || `${task.completedRounds || 0}/${task.maxCompleteLimit || task.completeNum || 0}`;
                        }
                        this.log(`- ${task.name}: ${progress} (${task.rewardScore} 积分)`);
                    }
                });
                this.log('');
            }
        } catch (error) {
            this.log('❌ 获取每日任务出错: ' + error.message);
        }
    }

    async getRecommendedSongs() {
        try {
            const response = await axios.post(
                `${this.baseUrl}/home/getRecommend`,
                { type: 1 },
                { headers: this.headers }
            );
            return response.data?.data || [];
        } catch (error) {
            this.log('❌ 获取推荐歌曲出错: ' + error.message);
            return [];
        }
    }

    async addToHistory(musicId) {
        try {
            await axios.post(
                `${this.baseUrl}/musicHistory/addToHistory/${musicId}`,
                {},
                { headers: this.headers }
            );
        } catch (error) {
            this.log('❌ 添加到历史记录出错: ' + error.message);
        }
    }

    async getMusicDetails(musicId) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/music/getDetailById?musicId=${musicId}`,
                { headers: this.headers }
            );
            return response.data?.data;
        } catch (error) {
            this.log('❌ 获取音乐详情出错: ' + error.message);
            return null;
        }
    }

    async sendHeartbeat() {
        try {
            const now = Date.now();
            if (now - this.lastHeartbeat >= 30000) {
                await axios.post(
                    `${this.baseUrl}/music/userOnlineTime/receiveHeartbeat`,
                    {},
                    { headers: this.headers }
                );
                this.lastHeartbeat = now;
                process.stdout.write('💓');
            }
        } catch (error) {
            // 静默处理心跳错误
        }
    }

    async playMusic(musicId) {
        try {
            await axios.post(
                `${this.baseUrl}/musicUserBehavior/playEvent`,
                { musicId, event: 'playing' },
                { headers: this.headers }
            );
            return true;
        } catch (error) {
            return false;
        }
    }

    async endMusic(musicId) {
        try {
            await axios.post(
                `${this.baseUrl}/musicUserBehavior/playEvent`,
                { musicId, event: 'playEnd' },
                { headers: this.headers }
            );
            return true;
        } catch (error) {
            this.log('❌ 结束音乐播放出错: ' + error.message);
            return false;
        }
    }

    async likeMusic(musicId) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/musicMyFavorite/addToMyFavorite?musicId=${musicId}`,
                {},
                { headers: this.headers }
            );
            return response.data?.success || false;
        } catch (error) {
            this.log('❌ 点赞音乐出错: ' + error.message);
            return false;
        }
    }

    async commentMusic(musicId, content = "good one") {
        try {
            const commentData = {
                content,
                musicId,
                parentId: 0,
                rootId: 0
            };
            
            const response = await axios.post(
                `${this.baseUrl}/musicComment/addComment`,
                commentData,
                { headers: this.headers }
            );
            return response.data?.success || false;
        } catch (error) {
            this.log('❌ 评论音乐出错: ' + error.message);
            return false;
        }
    }

    async playSession() {
        try {
            if (this.dailyPlayCount >= this.DAILY_LIMIT) {
                this.log(`\n🎵 已达到每日限制 (${this.DAILY_LIMIT}/${this.DAILY_LIMIT})。等待重置...`);
                return false;
            }

            const songs = await this.getRecommendedSongs();
            if (!songs || songs.length === 0) {
                this.log('\n❌ 没有可用的歌曲，5秒后重试...');
                await new Promise(resolve => setTimeout(resolve, 5000));
                return true;
            }

            for (const song of songs) {
                if (this.playedSongs.has(song.id)) continue;

                this.playedSongs.add(song.id);
                this.dailyPlayCount++;

                const musicDetails = await this.getMusicDetails(song.id) || {};
                const duration = musicDetails.duration || song.duration || 180;
                
                await this.addToHistory(song.id);

                const songName = song.musicName || musicDetails.musicName || '未知歌曲';
                const author = song.author || musicDetails.author || '未知艺术家';

                this.log('\n▶️  正在播放:');
                this.log(`🎵 标题: ${songName}`);
                this.log(`👤 艺术家: ${author}`);
                this.log(`🆔 音乐ID: ${song.id}`);
                this.log(`📊 进度: 今天已播放 ${this.dailyPlayCount}/${this.DAILY_LIMIT} 首歌`);
                this.log(`⏱️  时长: ${this.formatTime(duration)}`);

                const likeSuccess = await this.likeMusic(song.id);
                this.log(`${likeSuccess ? '❤️' : '💔'} 点赞状态: ${likeSuccess ? '成功' : '失败'}`);
                
                const commentSuccess = await this.commentMusic(song.id);
                this.log(`💬 评论状态: ${commentSuccess ? '成功' : '失败'}`);

                if (await this.playMusic(song.id)) {
                    let secondsPlayed = 0;
                    
                    for (let timeLeft = duration; timeLeft > 0; timeLeft--) {
                        await this.sendHeartbeat();
                        secondsPlayed++;
                        this.totalListeningTime++;
                        
                        this.log(`⏳ 剩余时间: ${this.formatTime(timeLeft)} | 收听时间: ${Math.floor(this.totalListeningTime / 60)} 分钟`, true);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }

                    const endSuccess = await this.endMusic(song.id);
                    
                    if (endSuccess) {
                        this.log('\n✅ 播放完成');
                    } else {
                        this.log('\n⚠️ 歌曲结束但播放结束事件失败');
                    }
                    
                    await this.getUserInfo();
                    await this.getDailyTasks();
                    break;
                } else {
                    this.log('\n❌ 播放歌曲失败');
                }
            }

            return true;
        } catch (error) {
            this.log('❌ 播放会话出错: ' + error.message);
            await new Promise(resolve => setTimeout(resolve, 5000));
            return true;
        }
    }

    async refreshToken() {
        try {
            this.log('🔄 正在获取token...');
            
            if (!this.privateKey) {
                this.log('❌ 无法获取token：未提供私钥');
                return false;
            }

            // 从私钥创建钱包
            const wallet = new ethers.Wallet(this.privateKey);
            this.log('📝 钱包地址: ' + wallet.address);
            
            const axiosInstance = axios.create({
                timeout: 30000,
                headers: DEFAULT_HEADERS
            });
            
            // 获取会话
            const session = await getSession(axiosInstance);
            if (!session) {
                this.log('❌ 获取会话失败');
                return false;
            }
            this.log('✅ 会话ID: ' + session.sessionId);
            
            // 获取nonce
            const nonce = await getNonce(axiosInstance);
            if (!nonce) {
                this.log('❌ 获取nonce失败');
                return false;
            }
            this.log('✅ 获取nonce成功');
            
            // 签名消息
            const { message, signature } = await signMessage({ address: wallet.address, privateKey: this.privateKey }, nonce);
            this.log('✅ 消息签名成功');
            
            // 验证钱包
            const verifyResult = await verifyWallet(axiosInstance, message, signature, this.inviteCode);
            
            if (verifyResult?.success) {
                const newToken = verifyResult.data.token;
                this.log('🎉 验证成功! 已获取token');
                
                // 更新token和headers
                this.token = newToken;
                this.headers.token = newToken;
                
                return true;
            } else {
                this.log('❌ 钱包验证失败');
                return false;
            }
        } catch (error) {
            this.log('❌ 获取token过程中出错: ' + error.message);
            return false;
        }
    }

    async startDailyLoop() {
        while (true) {
            const shouldContinue = await this.playSession();
            
            if (!shouldContinue) {
                this.log('\n⏰ 等待24小时后开始下一个会话...');
                for (let timeLeft = 24 * 60 * 60; timeLeft > 0; timeLeft--) {
                    this.log(`⏳ 下一个会话倒计时: ${this.formatTime(timeLeft)}`, true);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                this.dailyPlayCount = 0;
                this.playedSongs.clear();
                this.totalListeningTime = 0;
                this.log('\n🔄 开始新的每日会话');
                
                // 循环开始前刷新token
                const tokenRefreshed = await this.refreshToken();
                if (!tokenRefreshed) {
                    this.log('⚠️ Token刷新失败，本次循环将被跳过');
                    continue;
                }
                
                await this.getUserInfo();
                await this.getDailyTasks();
            } else {
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
}

async function readPrivateKeys() {
    try {
        // 读取私钥
        const walletsPath = path.join(__dirname, 'wallets.txt');
        const privateKeys = [];
        if (fsSync.existsSync(walletsPath)) {
            const content = await fs.readFile(walletsPath, 'utf8');
            privateKeys.push(...content.split('\n')
                .map(line => line.trim())
                .filter(line => line && line.startsWith('0x')));
            return privateKeys;
        } else {
            console.error('❌ wallets.txt文件不存在，请创建该文件并添加私钥');
            return [];
        }
    } catch (error) {
        console.error('❌ 读取wallets.txt出错:', error.message);
        return [];
    }
}

async function main() {
    try {
        console.log('🔐 Fireverse自动化工具启动中...');
        
        // 只读取私钥
        const privateKeys = await readPrivateKeys();
        
        if (privateKeys.length === 0) {
            console.error('❌ wallets.txt中没有找到私钥，无法继续运行');
            process.exit(1);
        }

        console.log(`🔑 找到 ${privateKeys.length} 个私钥`);
        
        // 创建机器人实例，只传入私钥
        const bots = privateKeys.map((privateKey, index) => 
            new FireverseMusicBot(privateKey, index + 1));
        
        const initResults = await Promise.all(bots.map(bot => bot.initialize()));
        
        const activeBots = bots.filter((_, index) => initResults[index]);
        
        if (activeBots.length === 0) {
            console.error('❌ 没有账号能够成功初始化');
            process.exit(1);
        }
        
        console.log(`✅ 成功初始化 ${activeBots.length}/${privateKeys.length} 个账号`);

        await Promise.all(activeBots.map(bot => bot.startDailyLoop()));
    } catch (error) {
        console.error('❌ 主程序出错:', error);
        process.exit(1);
    }
}

main().catch(console.error);