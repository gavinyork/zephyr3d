/**
 * @apiDefine CommonSuccess
 * @apiSuccess {Number} code 请求成功为0，失败为非0值
 * @apiSuccess {String} message 请求错误信息
 * @apiSuccess {Number} totalNum 如果是分页数据请求，返回总记录数
 * @apiSuccess {Object} data 返回null
 */

/**
 * @apiDefine CommonSuccessExample
 * @apiSuccessExample {json} 成功响应示例:
 * {
 *   "code": 0,
 *   "message": "请求成功",
 *   "totalNum": 0,
 *   "data": null
 * }
 */

export * from './apidef';
