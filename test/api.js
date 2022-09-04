"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotFoundError = exports.setBot = exports.apply = void 0;
const client_1 = require("../lib/client");
const utils_1 = require("./utils");
let bot;
class NotFoundError extends Error {
}
exports.NotFoundError = NotFoundError;
class ParamsNotCapError extends Error {
}
// type BotType = typeof bot
// type BotFunctionsType = NonNullable<{
//     [key in keyof BotType]: BotType[key] extends Function ? BotType[key] : never;
// }[typeof available_actions[number]]>
const actionsMap = {
    "sendPrivateMsg": client_1.Client.prototype.sendPrivateMsg,
    "sendGroupMsg": client_1.Client.prototype.sendGroupMsg
    //   "sendDiscussMsg",
    //   "sendMsg",
    //   "deleteMsg",
    //   "getMsg",
    //   "getForwardMsg",
    //   "sendLike",
    //   "setGroupKick",
    //   "setGroupBan",
    //   "setGroupAnonymousBan",
    //   "setGroupWholeBan",
    //   "setGroupAdmin",
    //   "setGroupAnonymous",
    //   "setGroupCard",
    //   "setGroupName",
    //   "setGroupLeave",
    //   "sendGroupNotice",
    //   "setGroupSpecialTitle",
    //   "setFriendAddRequest",
    //   "setGroupAddRequest",
    //   "getLoginInfo",
    //   "getStrangerInfo",
    //   "getFriendList",
    //   "getStrangerList",
    //   "getGroupInfo",
    //   "getGroupList",
    //   "getGroupMemberInfo",
    //   "getGroupMemberList",
    //   // "getGroupHonorInfo", //暂无实现计划
    //   "getCookies",
    //   "getCsrfToken",
    //   // "getCredentials", //暂无实现计划
    //   // "getRecord", //暂无实现计划
    //   // "getImage", //暂无实现计划
    //   "canSendImage",
    //   "canSendRecord",
    //   "getStatus",
    //   "getVersionInfo",
    //   // "setRestart", //todo
    //   "cleanCache",
    //   //enhancement
    //   "setOnlineStatus",
    //   "sendGroupPoke",
    //   "addGroup",
    //   "addFriend",
    //   "deleteFriend",
    //   "inviteFriend",
    //   "sendLike",
    //   "setNickname",
    //   "setDescription",
    //   "setGender",
    //   "setBirthday",
    //   "setSignature",
    //   "setPortrait",
    //   "setGroupPortrait",
    //   "getSystemMsg",
    //   "getChatHistory",
    //   "sendTempMsg",
};
const typeMap = {
    sendPrivateMsg: ["number", "Sendable", "Quotable"],
    sendGroupMsg: ["number", "Sendable", "Quotable"]
};
const queue = [];
let queue_running = false;
let rate_limit_interval = 500;
async function runQueue() {
    if (queue_running)
        return;
    while (queue.length > 0) {
        queue_running = true;
        const task = queue.shift();
        if (!task) {
            break;
        }
        const { action, param_arr } = task;
        const func = bot[action];
        func.apply(bot, param_arr);
        await new Promise((resolve) => {
            setTimeout(resolve, rate_limit_interval);
        });
    }
    queue_running = false;
}
/**
 * 设置发送消息上限个数
 * @param client
 * @param rli rate_limit_interval
 */
function setBot(client, rli) {
    bot = client;
    if (isNaN(rli) || rli < 0)
        rli = 500;
    rate_limit_interval = rli;
}
exports.setBot = setBot;
// TODO: feat
// function quickOperate(event, res) {
//     if (event.post_type === "message" && res.reply) {
//         const action =
//             event.message_type === "private" ? "sendPrivateMsg" : "sendGroupMsg";
//         const id =
//             event.message_type === "private" ? event.user_id : event.group_id;
//         bot[action](id, res.reply, res.auto_escape);
//         if (event.group_id) {
//             if (res.delete) bot.deleteMsg(event.message_id);
//             if (res.kick && !event.anonymous)
//                 bot.setGroupKick(event.group_id, event.user_id, res.reject_add_request);
//             if (res.ban)
//                 bot.setGroupBan(
//                     event.group_id,
//                     event.user_id,
//                     res.ban_duration ? res.ban_duration : 1800
//                 );
//         }
//     }
//     if (event.post_type === "request" && res.hasOwnProperty("approve")) {
//         const action =
//             event.request_type === "friend"
//                 ? "setFriendAddRequest"
//                 : "setGroupAddRequest";
//         bot[action](
//             event.flag,
//             res.approve,
//             res.reason ? res.reason : "",
//             res.block ? true : false
//         );
//     }
// }
// function handleQuickOperation(data) {
//     const event = data.params.context,
//         res = data.params.operation;
//     quickOperate(event, res);
// }
/**
 * 从输入数据中获取方法需要的数据，不包括类型检查
 * 若为 null 或 undefined 将抛出异常
 * @param action 方法名
 * @param data 输入数据
 * @returns 参数数据数组
 */
function convertParam(action, data) {
    const paramNames = (0, utils_1.getParamNames)(actionsMap[action]);
    const retArr = [];
    for (const key of paramNames) {
        if (data[key] === undefined || data[key] === null) {
            break;
        }
        retArr.push(data[key]);
    }
    return retArr;
}
/**
 * 将函数加入队列
 * @param req 实际请求
 */
async function apply(req) {
    let { action: actionRaw, data } = req;
    actionRaw = (0, utils_1.toHump)(actionRaw);
    if (Object.keys(actionsMap).includes(actionRaw)) {
        const action = actionRaw;
        queue.push({ action: action, param_arr: convertParam(action, data) });
        runQueue();
        const ret = {
            retcode: 1,
            status: "async",
            data: null,
        };
        return JSON.stringify(ret);
    }
    else {
        throw new NotFoundError();
    }
}
exports.apply = apply;
//# sourceMappingURL=api.js.map