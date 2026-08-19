import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import 'dayjs/locale/zh-cn'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.locale('zh-cn')

/** 平台统一时区（市场时钟 / 时间展示均以此为准） */
export const PLATFORM_TIMEZONE = 'Asia/Shanghai'

export default dayjs
