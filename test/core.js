"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startup = void 0;
const ws_1 = require("ws");
const client_1 = require("../lib/client");
const crypto_1 = __importDefault(require("crypto"));
const api_1 = require("./api");
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const url_1 = require("url");
const path_1 = require("path");
const os_1 = require("os");
const fs_1 = require("fs");
let config;
let bot;
let wss;
let websockets = new Set();
let account = 0, passdir = "", wsrCreated = false;
/**
 * 启动
 * @param deployAccount qq号
 * @param deployConfig 配置
 */
function startup(deployAccount, deployConfig) {
    account = deployAccount;
    config = deployConfig;
    config.data_dir = (0, path_1.join)((0, os_1.homedir)(), ".oicq");
    passdir = (0, path_1.join)((0, os_1.homedir)(), ".oicq", String(account));
    if (!(0, fs_1.existsSync)(passdir)) {
        (0, fs_1.mkdirSync)(passdir, 0o744);
    }
    console.log("已加载配置文件：", config);
    // enable heartbeat
    if (config.enable_heartbeat &&
        (config.use_ws || config.ws_reverse_url?.length)) {
        setInterval(() => {
            const json = JSON.stringify({
                self_id: account,
                time: Math.floor(Date.now() / 1000),
                post_type: "meta_event",
                meta_event_type: "heartbeat",
                interval: config.heartbeat_interval,
            });
            websockets.forEach((ws) => {
                ws.send(json);
            });
            if (wss) {
                wss.clients.forEach((ws) => {
                    ws.send(json);
                });
            }
        }, config.heartbeat_interval);
    }
    // enable message filter
    // init(config.event_filter);
    // create bot
    createBot();
    // create server
    createServer();
    setTimeout(botLogin, 500);
}
exports.startup = startup;
/**
 * 输入密码
 */
function inputPassword() {
    console.log("请输入密码(扫码登录直接按回车)：");
    process.stdin.once("data", (input) => {
        const data = input.toString().trim();
        if (!data.length) {
            (0, fs_1.writeFileSync)((0, path_1.join)(passdir, "password"), "", { mode: 0o600 });
            return bot.login();
        }
        const password = crypto_1.default.createHash("md5").update(data).digest();
        (0, fs_1.writeFileSync)((0, path_1.join)(passdir, "password"), password, { mode: 0o600 });
        bot.login(password);
    });
}
function botLogin() {
    const filepath = (0, path_1.join)(passdir, "password");
    try {
        const password = (0, fs_1.readFileSync)(filepath);
        bot.login(password);
    }
    catch {
        inputPassword();
    }
}
/**
 * 创建bot
 */
function createBot() {
    bot = (0, client_1.createClient)(account, config);
    (0, api_1.setBot)(bot, config.rate_limit_interval);
    bot.on("system.login.slider", () => {
        process.stdin.once("data", (input) => {
            bot.submitSlider(String(input).trim().replace("ticket:", "").trim().replace(/"/g, ""));
        });
    });
    bot.on("system.login.qrcode", () => {
        bot.logger.mark("扫码完成后回车登录。");
        process.stdin.once("data", () => {
            bot.login();
        });
    });
    bot.on("system.login.device", () => {
        bot.logger.mark("验证完成后回车登录。");
        process.stdin.once("data", () => {
            bot.login();
        });
    });
    bot.on("system.login.error", (data) => {
        if (data.code === -2)
            return bot.login();
        if (data.message.includes("密码错误"))
            inputPassword();
        else
            bot.terminate();
    });
    bot.on("system.online", () => {
        loop();
        dipatch({
            self_id: account,
            time: Math.floor(Date.now() / 1000),
            post_type: "meta_event",
            meta_event_type: "lifecycle",
            sub_type: "enable",
        });
        if (!wsrCreated)
            createReverseWS();
    });
    bot.on("system.offline", (data) => {
        dipatch({
            self_id: account,
            time: Math.floor(Date.now() / 1000),
            post_type: "meta_event",
            meta_event_type: "lifecycle",
            sub_type: "disable",
        });
    });
    bot.on("request", dipatch);
    bot.on("notice", (data) => {
        // if (config.use_cqhttp_notice) transNotice(data);
        dipatch(data);
    });
    bot.on("message", (data) => {
        if (config.post_message_format === "string")
            data.message = [{ type: "text", text: data.raw_message }];
        dipatch(data);
    });
}
/**
 * 分发事件
 */
function dipatch(event) {
    // if (!assert(event)) return;
    const json = JSON.stringify(event);
    const options = {
        method: "POST",
        timeout: config.post_timeout,
        headers: {
            "Content-Type": "application/json",
            "X-Self-ID": String(account),
            "User-Agent": "OneBot",
        },
    };
    if (config.secret) {
        options.headers = {
            ...options.headers,
            "X-Signature": "sha1=" +
                crypto_1.default
                    .createHmac("sha1", config.secret.toString())
                    .update(json)
                    .digest("hex")
        };
    }
    for (let url of config.post_url) {
        const protocol = url.startsWith("https") ? https_1.default : http_1.default;
        try {
            const req = protocol
                .request(url, options, (res) => {
                bot.logger.debug(`POST(${url})上报事件: ` + json);
                onHttpRes(event, res);
            })
                .on("error", (e) => {
                bot.logger.error(`POST(${url})上报失败：` + e.message);
            });
            req.end(json);
        }
        catch (e) {
            bot.logger.error(`POST(${url})上报失败：` + e.message);
        }
    }
    if (wss) {
        wss.clients.forEach((ws) => {
            bot.logger.debug(`正向WS上报事件: ` + json);
            ws.send(json);
        });
    }
    websockets.forEach((ws) => {
        bot.logger.debug(`反向WS(${ws.url})上报事件: ` + json);
        ws.send(json);
    });
}
/**
 * 创建http&ws服务器
 */
function createServer() {
    if (!config.use_http && !config.use_ws)
        return;
    const server = http_1.default.createServer((req, res) => {
        // 检查 http 功能
        if (!config.use_http)
            return res.writeHead(404).end();
        // 检查跨域
        if (req.method === "OPTIONS" && config.enable_cors) {
            return res
                .writeHead(200, {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, authorization",
            })
                .end();
        }
        // 检查鉴权
        if (config.access_token) {
            if (!req.headers["authorization"]) {
                const access_token = new url_1.URLSearchParams((0, url_1.parse)(req.url || "").query || "").get("access_token");
                if (access_token)
                    req.headers["authorization"] = access_token;
                else
                    return res.writeHead(401).end();
            }
            if (!req.headers["authorization"].includes(config.access_token))
                return res.writeHead(403).end();
        }
        onHttpReq(req, res);
    });
    if (config.use_ws) {
        wss = new ws_1.WebSocketServer({ server });
        wss.on("error", () => { });
        wss.on("connection", (ws, req) => {
            ws.on("error", () => { });
            // 检查鉴权
            if (config.access_token) {
                if (req.url) {
                    const url = new URL("http://www.example.com/" + req.url);
                    const accessToken = url.searchParams.get("access_token");
                    if (accessToken) {
                        req.headers["authorization"] = accessToken;
                    }
                }
                if (!req.headers["authorization"] ||
                    !req.headers["authorization"].includes(config.access_token))
                    return ws.close(1002);
            }
            onWSOpen(ws);
        });
    }
    server
        .listen(config.port, config.host, () => {
        const address = server.address();
        if (typeof address === "string") {
            bot.logger.info(`开启http服务器成功，监听${address}`);
        }
        else {
            bot.logger.info(`开启http服务器成功，监听${address?.address}:${address?.port}`);
        }
    })
        .on("error", (e) => {
        bot.logger.error(e.message);
        bot.logger.error("开启http服务器失败，进程退出。");
        process.exit(0);
    });
}
/**
 * ws连接建立
 * @param {WebSocket} ws
 */
function onWSOpen(ws) {
    ws.on("message", (data) => {
        onWSMessage(ws, data);
    });
    ws.send(JSON.stringify({
        self_id: account,
        time: Math.floor(Date.now() / 1000),
        post_type: "meta_event",
        meta_event_type: "lifecycle",
        sub_type: "connect",
    }));
    ws.send(JSON.stringify({
        self_id: account,
        time: Math.floor(Date.now() / 1000),
        post_type: "meta_event",
        meta_event_type: "lifecycle",
        sub_type: "enable",
    }));
}
/**
 * 创建反向ws
 */
function createReverseWS() {
    wsrCreated = true;
    const headers = {
        "X-Self-ID": String(account),
        "X-Client-Role": "Universal",
        "User-Agent": "OneBot",
    };
    if (config.access_token)
        headers.Authorization = "Bearer " + config.access_token;
    for (let url of config.ws_reverse_url) {
        createWSClient(url, headers);
    }
}
function createWSClient(url, headers) {
    try {
        const ws = new ws_1.WebSocket(url, { headers });
        ws.on("error", () => { });
        ws.on("open", () => {
            bot.logger.info(`反向ws连接(${url})连接成功。`);
            websockets.add(ws);
            onWSOpen(ws);
        });
        ws.on("close", (code) => {
            websockets.delete(ws);
            if ((code === 1000 && config.ws_reverse_reconnect_on_code_1000 === false) ||
                config.ws_reverse_reconnect_interval >= 0 === false)
                return bot.logger.info(`反向ws连接(${url})被关闭，关闭码${code}。不再重连。`);
            bot.logger.error(`反向ws连接(${url})被关闭，关闭码${code}，将在${config.ws_reverse_reconnect_interval}毫秒后尝试连接。`);
            setTimeout(() => {
                createWSClient(url, headers);
            }, config.ws_reverse_reconnect_interval);
        });
    }
    catch (e) {
        bot.logger.error(e);
    }
}
/**
 * 收到http响应
 */
function onHttpRes(event, res) {
    let databuf = [];
    res.on("data", (chunk) => databuf.push(chunk));
    res.on("end", () => {
        let data = Buffer.concat(databuf).toString();
        debug(`收到HTTP响应：${res.statusCode} ` + databuf);
        // try {
        //     quickOperate(event, JSON.parse(data));
        // } catch (e) { }
    });
}
function getData(req) {
    return new Promise((resolve) => {
        let databuf = [];
        req.on("data", (chunk) => databuf.push(chunk));
        req.on("end", async () => { resolve(Buffer.concat(databuf).toString()); });
    });
}
/**
 * 处理http请求
 */
async function onHttpReq(req, res) {
    const reqUrl = new URL(req.url || "", `http://${req.headers.host}`);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const data = await getData(req);
    debug(`收到${req.method}请求: ` + data);
    try {
        const dataParsed = JSON.parse(data);
        const ret = await (0, api_1.apply)({ action: reqUrl.pathname, data: dataParsed });
        res.end(ret);
    }
    catch (e) {
        if (e instanceof api_1.NotFoundError)
            res.writeHead(404).end();
        else
            res.writeHead(400).end();
    }
}
/**
 * 收到ws消息
 * @param {WebSocket} ws
 */
async function onWSMessage(ws, dataRaw) {
    debug(`收到WS消息: ` + dataRaw);
    let data = JSON.parse(dataRaw.toString());
    try {
        // TODO: quick opration
        // if (
        //     (data.action && data.action === ".handle_quick_operation") ||
        //     data.action === ".handle_quick_operation_async" ||
        //     data.action === ".handle_quick_operation_rate_limited"
        // ) {
        //     // handleQuickOperation(data);
        //     var ret = JSON.stringify({
        //         retcode: 1,
        //         status: "async",
        //         data: null,
        //         echo: data.echo,
        //     });
        // } else {
        const ret = await (0, api_1.apply)(data);
        // }
        ws.send(ret);
    }
    catch (e) {
        if (e instanceof api_1.NotFoundError)
            var retcode = 1404;
        else
            var retcode = 1400;
        ws.send(JSON.stringify({
            retcode: retcode,
            status: "failed",
            data: null,
            echo: data.echo || null,
        }));
    }
}
function debug(msg) {
    if (bot && bot.logger)
        bot.logger.debug(msg.toString());
    else
        console.log(msg.toString());
}
function loop() {
    const help = `※你已成功登录，此控制台有简单的指令可用于调试。
※发言: send <target> <message>
※下线结束程序: bye
※执行任意代码: eval <code>`;
    console.log(help);
    process.stdin
        .on("data", async (input) => {
        let inputStr = input.toString().trim();
        if (!inputStr)
            return;
        const cmd = inputStr.split(" ")[0];
        const param = inputStr.replace(cmd, "").trim();
        switch (cmd) {
            case "bye":
                bot.logout().then(() => process.exit());
                break;
            case "send":
                const abc = param.split(" ");
                const target = parseInt(abc[0]);
                if (bot.gl.has(target))
                    bot.sendGroupMsg(target, abc[1]);
                else
                    bot.sendPrivateMsg(target, abc[1]);
                break;
            case "eval":
                try {
                    let res = await eval(param);
                    console.log("Result:", res);
                }
                catch (e) {
                    console.log(e);
                }
                break;
            default:
                console.log(help);
                break;
        }
    })
        .on("error", () => { });
}
//# sourceMappingURL=core.js.map