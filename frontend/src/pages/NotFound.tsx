import { Button, Result } from 'antd'
import { useNavigate } from 'react-router'

/** 404 */
export default function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <Result
      status="404"
      title="404"
      subTitle="页面不存在，或链接已失效。"
      extra={
        <Button type="primary" onClick={() => navigate('/')}>
          返回工作台
        </Button>
      }
    />
  )
}
