// SPDX-License-Identifier: Apache-2.0

export {
  createProjectAPI,
  getProjectAPI,
  sceneMetaForComposition,
  type CreateCompositionInput,
  type DeleteCompositionResult,
  type ProjectAPI,
} from './doc'
export { useProjectAPI } from './hooks'
export {
  exportCompositionToHypeBytes,
  importScenesFromHypeBytes,
  transferCompositionScenes,
  type SceneTransferResult,
  type TransferredScene,
} from './sceneTransfer'
