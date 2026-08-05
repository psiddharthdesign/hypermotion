// SPDX-License-Identifier: Apache-2.0

import { useMemo } from 'react'
import { useSceneAPI } from '@/scene'
import { getProjectAPI, type ProjectAPI } from './doc'

export function useProjectAPI(): ProjectAPI {
  const scene = useSceneAPI()
  return useMemo(() => {
    const project = getProjectAPI(scene)
    project.ensureInitialized()
    return project
  }, [scene])
}
