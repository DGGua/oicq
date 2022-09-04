"use strict";

import { WebSocketServer, WebSocket, RawData } from "ws";
import { Client, Config, createClient } from "../lib/client";
import crypto from "crypto";
import {
    apply,
    NotFoundError,
    setBot,
} from "./api";
import http, { IncomingMessage, ServerResponse } from "http";
import https from "https";
import { parse, URLSearchParams } from "url";
import { join } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { EventMap } from "../lib";
import { recording } from "log4js";
interface BotDeployConfig extends Config {
    platform: 1 | 2 | 3 | 4 | 5; //1:安卓手机 2:aPad 3:安卓手表 4:MacOS 5:iPad
    log_level: "trace" | "debug" | "info" | "warn" | "error" | "mark"; //trace,debug,info,warn,error,mark
    use_cqhttp_notice: boolean; //是否使用cqhttp标准的notice事件格式
    host: string; //监听主机名
    port: number; //端口
    use_http: boolean; //启用http
    use_ws: false; //启用正向ws，和http使用相同地址和端口
    access_token: string; //访问api的token
    secret: string; //上报数据的sha1签名密钥
    post_timeout: number; //post超时时间(秒)
    post_message_format: "array" | "string"; //"string"或"array"
    enable_cors: boolean; //是否允许跨域请求
    enable_heartbeat: boolean; //是否启用ws心跳
    heartbeat_interval: number; //ws心跳间隔(毫秒)
    rate_limit_interval: number; //使用_rate_limited后缀限速调用api的排队间隔时间(毫秒)
    event_filter: string; //json格式的事件过滤器文件路径
    post_url: string[]; //上报地址，可以添加多个url
    ws_reverse_url: string[]; //反向ws地址，可以添加多个url
    ws_reverse_reconnect_interval: number; //反向ws断线重连间隔(毫秒)，设为负数直接不重连
    ws_reverse_reconnect_on_code_1000: boolean; //反向ws是否在关闭状态码为1000的时候重连
}

let config: BotDeployConfig;

let bot: Client;

let wss: WebSocketServer;

let websockets: Set<WebSocket> = new Set();

let account = 0,
    passdir = "",
    wsrCreated = false;


/**
 * 启动
 * @param deployAccount qq号
 * @param deployConfig 配置
 */
function startup(deployAccount: number, deployConfig: BotDeployConfig) {
    account = deployAccount
    config = deployConfig;
    config.data_dir = join(homedir(), ".oicq");
    passdir = join(homedir(), ".oicq", String(account));
    if (!existsSync(passdir)) {
        mkdirSync(passdir, 0o744);
    }
    console.log("已加载配置文件：", config);

    // enable heartbeat
    if (
        config.enable_heartbeat &&
        (config.use_ws || config.ws_reverse_url?.length)
    ) {
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

/**
 * 输入密码
 */
function inputPassword() {
    console.log("请输入密码(扫码登录直接按回车)：");
    process.stdin.once("data", (input) => {
        const data = input.toString().trim();
        if (!data.length) {
            writeFileSync(join(passdir, "password"), "", { mode: 0o600 });
            return bot.login();
        }
        const password = crypto.createHash("md5").update(data).digest();
        writeFileSync(join(passdir, "password"), password, { mode: 0o600 });
        bot.login(password);
    });
}

function botLogin() {
    const filepath = join(passdir, "password");
    try {
        const password = readFileSync(filepath);
        bot.login(password);
    } catch {
        inputPassword();
    }
}

/**
 * 创建bot
 */
function createBot() {
    bot = createClient(account, config);
    setBot(bot, config.rate_limit_interval);
    bot.on("system.login.slider", () => {
        process.stdin.once("data", (input) => {
            bot.submitSlider(
                String(input).trim().replace("ticket:", "").trim().replace(/"/g, "")
            );
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
        if (data.code === -2) return bot.login();
        if (data.message.includes("密码错误")) inputPassword();
        else bot.terminate();
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
        if (!wsrCreated) createReverseWS();
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
function dipatch(event: Parameters<EventMap[keyof EventMap]>[0] | Record<string, any>) {
    // if (!assert(event)) return;
    const json = JSON.stringify(event);
    const options: https.RequestOptions = {
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
                crypto
                    .createHmac("sha1", config.secret.toString())
                    .update(json)
                    .digest("hex")
        }
    }
    for (let url of config.post_url) {
        const protocol = url.startsWith("https") ? https : http;
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
        } catch (e: any) {
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
    if (!config.use_http && !config.use_ws) return;
    const server = http.createServer((req, res) => {
        // 检查 http 功能
        if (!config.use_http) return res.writeHead(404).end();

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
                const access_token = new URLSearchParams(
                    parse(req.url || "").query || ""
                ).get("access_token");
                if (access_token) req.headers["authorization"] = access_token;
                else return res.writeHead(401).end();
            }
            if (!req.headers["authorization"].includes(config.access_token))
                return res.writeHead(403).end();
        }

        onHttpReq(req, res);
    });
    if (config.use_ws) {
        wss = new WebSocketServer({ server });
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
                if (
                    !req.headers["authorization"] ||
                    !req.headers["authorization"].includes(config.access_token)
                )
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
            } else {
                bot.logger.info(
                    `开启http服务器成功，监听${address?.address}:${address?.port}`
                );
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
function onWSOpen(ws: WebSocket) {
    ws.on("message", (data) => {
        onWSMessage(ws, data);
    });
    ws.send(
        JSON.stringify({
            self_id: account,
            time: Math.floor(Date.now() / 1000),
            post_type: "meta_event",
            meta_event_type: "lifecycle",
            sub_type: "connect",
        })
    );
    ws.send(
        JSON.stringify({
            self_id: account,
            time: Math.floor(Date.now() / 1000),
            post_type: "meta_event",
            meta_event_type: "lifecycle",
            sub_type: "enable",
        })
    );
}

/**
 * 创建反向ws
 */
function createReverseWS() {
    wsrCreated = true;
    const headers: Record<string, string> = {
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
function createWSClient(url: string, headers: Record<string, string>) {
    try {
        const ws = new WebSocket(url, { headers });
        ws.on("error", () => { });
        ws.on("open", () => {
            bot.logger.info(`反向ws连接(${url})连接成功。`);
            websockets.add(ws);
            onWSOpen(ws);
        });
        ws.on("close", (code) => {
            websockets.delete(ws);
            if (
                (code === 1000 && config.ws_reverse_reconnect_on_code_1000 === false) ||
                config.ws_reverse_reconnect_interval >= 0 === false
            )
                return bot.logger.info(
                    `反向ws连接(${url})被关闭，关闭码${code}。不再重连。`
                );
            bot.logger.error(
                `反向ws连接(${url})被关闭，关闭码${code}，将在${config.ws_reverse_reconnect_interval}毫秒后尝试连接。`
            );
            setTimeout(() => {
                createWSClient(url, headers);
            }, config.ws_reverse_reconnect_interval);
        });
    } catch (e) {
        bot.logger.error(e);
    }
}

/**
 * 收到http响应
 */
function onHttpRes(event: Parameters<EventMap[keyof EventMap]>[0] | Record<string, any>, res: IncomingMessage) {
    let databuf: any[] = [];
    res.on("data", (chunk) => databuf.push(chunk));
    res.on("end", () => {
        let data = Buffer.concat(databuf).toString();
        debug(`收到HTTP响应：${res.statusCode} ` + databuf);
        // try {
        //     quickOperate(event, JSON.parse(data));
        // } catch (e) { }
    });
}

function getData(req: IncomingMessage) {
    return new Promise<string>((resolve) => {
        let databuf: any[] = [];
        req.on("data", (chunk) => databuf.push(chunk));
        req.on("end", async () => { resolve(Buffer.concat(databuf).toString()) })
    })
}

/**
 * 处理http请求
 */
async function onHttpReq(req: IncomingMessage, res: ServerResponse) {

    const reqUrl = new URL(req.url || "", `http://${req.headers.host}`)
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const data = await getData(req)
    debug(`收到${req.method}请求: ` + data);
    try {
        const dataParsed = JSON.parse(data)
        const ret = await apply({ action: reqUrl.pathname, data: dataParsed });
        res.end(ret);
    } catch (e) {
        if (e instanceof NotFoundError) res.writeHead(404).end();
        else res.writeHead(400).end();
    }
}
/**
 * 收到ws消息
 * @param {WebSocket} ws
 */
async function onWSMessage(ws: WebSocket, dataRaw: RawData) {
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
        const ret = await apply(data);
        // }
        ws.send(ret);
    } catch (e) {
        if (e instanceof NotFoundError) var retcode = 1404;
        else var retcode = 1400;
        ws.send(
            JSON.stringify({
                retcode: retcode,
                status: "failed",
                data: null,
                echo: data.echo || null,
            })
        );
    }
}

function debug(msg: any) {
    if (bot && bot.logger) bot.logger.debug(msg.toString());
    else console.log(msg.toString());
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
            if (!inputStr) return;
            const cmd = inputStr.split(" ")[0];
            const param = inputStr.replace(cmd, "").trim();
            switch (cmd) {
                case "bye":
                    bot.logout().then(() => process.exit());
                    break;
                case "send":
                    const abc = param.split(" ");
                    const target = parseInt(abc[0]);
                    if (bot.gl.has(target)) bot.sendGroupMsg(target, abc[1]);
                    else bot.sendPrivateMsg(target, abc[1]);
                    break;
                case "eval":
                    try {
                        let res = await eval(param);
                        console.log("Result:", res);
                    } catch (e) {
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

export { startup };
