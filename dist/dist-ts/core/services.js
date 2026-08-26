/**
 * 核心服务注册 - 从源模块直接注册服务到容器
 * @module core/services
 * @description 将日志、事件总线、配置等核心服务注册到 ServiceContainer，
 *              供各模块通过 container.resolve() 获取，避免通过 index.js 中转。
 */
import { eventBus } from '../tools/events.js';
import { logger } from '../tools/logger.js';
import { LOG_LEVELS } from './constants.js';
import { container, SERVICE_KEYS } from './container.js';
container.register(SERVICE_KEYS.LOGGER, () => logger);
container.register(SERVICE_KEYS.EVENT_BUS, () => eventBus);
container.register(SERVICE_KEYS.CONFIG, () => LOG_LEVELS);
