import { Client } from "../lib/client";
declare class NotFoundError extends Error {
}
interface ActionRequest {
    action: string;
    data: Record<string, any>;
    echo?: string;
}
/**
 * 设置发送消息上限个数
 * @param client
 * @param rli rate_limit_interval
 */
declare function setBot(client: Client, rli: number): void;
/**
 * 将函数加入队列
 * @param req 实际请求
 */
declare function apply(req: ActionRequest): Promise<string>;
export { apply, setBot, NotFoundError };
