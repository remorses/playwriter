import { redirect } from 'react-router'

export const loader = () => {
  throw redirect('https://github.com/remorses/playwriter')
}

export default function Index() {
  return null
}
