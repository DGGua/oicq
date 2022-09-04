import { Config } from "../lib/client";
interface BotDeployConfig extends Config {
    platform: 1 | 2 | 3 | 4 | 5;
    log_level: "trace" | "debug" | "info" | "warn" | "error" | "mark";
    use_cqhttp_notice: boolean;
    host: string;
    port: number;
    use_http: boolean;
    use_ws: false;
    access_token: string;
    secret: string;
    post_timeout: number;
    post_message_format: "array" | "string";
    enable_cors: boolean;
    enable_heartbeat: boolean;
    heartbeat_interval: number;
    rate_limit_interval: number;
    event_filter: string;
    post_url: string[];
    ws_reverse_url: string[];
    ws_reverse_reconnect_interval: number;
    ws_reverse_reconnect_on_code_1000: boolean;
}
/**
 * 启动
 * @param deployAccount qq号
 * @param deployConfig 配置
 */
declare function startup(deployAccount: number, deployConfig: BotDeployConfig): void;
export { startup };
