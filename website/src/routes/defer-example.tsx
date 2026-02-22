import React from 'react'
import { sleep } from '../lib/utils'
import { Route } from './+types/defer-example'

async function getProjectLocation() {
  return Promise.resolve().then(() => sleep(1000).then(() => 'hi'))
}

export async function loader({}: Route.LoaderArgs) {
  return {
    project: getProjectLocation(),
  }
}

export default function ProjectRoute({ loaderData }: Route.ComponentProps) {
  const location = React.use(loaderData.project)

  return (
    <main>
      <h1>Let's locate your project</h1>
      <p>Your project is at {location}.</p>
    </main>
  )
}
