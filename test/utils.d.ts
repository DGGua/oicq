/**
 * 从函数中提取参数列表
 * from https://stackoverflow.com/questions/1007981/how-to-get-function-parameter-names-values-dynamically
 * @param func 函数
 * @returns 参数数组，不包括可选参数等特殊情况
 */
declare function getParamNames(func: Function): string[];
/**
 * 将 path 中的斜杠去掉
 * @param actionRaw like "/sendPrivateMsg"
 * @returns like "sendPrivateMsg"
 */
declare function toHump(actionRaw: string): string;
export { getParamNames, toHump };
