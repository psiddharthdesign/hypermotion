// SPDX-License-Identifier: Apache-2.0

import { CAMERA_COMPOSITION_GUIDE_OPTIONS, normalizeCameraCompositionGuide, type CameraCompositionGuide } from '@/scene/cameraCompositionGuide'
import { FieldRow } from './fields/FieldRow'
import { SelectField } from './fields/SelectField'

export function CameraCompositionGuideField({ value, onCommit }: {
  value: CameraCompositionGuide | undefined
  onCommit: (value: CameraCompositionGuide) => void
}) {
  return <FieldRow label="Grid overlay" layout="compound">
    <SelectField<CameraCompositionGuide>
      ariaLabel="Camera grid overlay"
      value={normalizeCameraCompositionGuide(value)}
      options={CAMERA_COMPOSITION_GUIDE_OPTIONS}
      onCommit={onCommit} />
  </FieldRow>
}
