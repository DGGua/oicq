// 
const STRIP_COMMENTS = /(\/\/.*$)|(\/\*[\s\S]*?\*\/)|(\s*=[^,\)]*(('(?:\\'|[^'\r\n])*')|("(?:\\"|[^"\r\n])*"))|(\s*=[^,\)]*))/mg;
const ARGUMENT_NAMES = /([^\s,]+)/g;
/**
 * 从函数中提取参数列表
 * from https://stackoverflow.com/questions/1007981/how-to-get-function-parameter-names-values-dynamically
 * @param func 函数
 * @returns 参数数组，不包括可选参数等特殊情况
 */
function getParamNames(func: Function): string[] {
    const fnStr = func.toString().replace(STRIP_COMMENTS, '');
    const result = fnStr.slice(fnStr.indexOf('(') + 1, fnStr.indexOf(')')).match(ARGUMENT_NAMES) || [];
    return result;
}

/**
 * 将 path 中的斜杠去掉
 * @param actionRaw like "/sendPrivateMsg"
 * @returns like "sendPrivateMsg"
 */
function toHump(actionRaw: string) {
    return actionRaw.replace(/\//g, "");
}

export { getParamNames, toHump }