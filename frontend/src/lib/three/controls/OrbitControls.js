import { OrbitControls as ThreeOrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * Re-export Three.js OrbitControls with additional functionality
 */

export class OrbitControls extends ThreeOrbitControls {
  constructor(camera, domElement) {
    super(camera, domElement);
  }

  /**
   * Apply configuration to the controls
   * @param {Object} config - Configuration object with properties to apply
   * @param {boolean} [config.enableDamping] - Whether to enable damping
   * @param {number} [config.dampingFactor] - Damping factor
   * @param {number} [config.minDistance] - Minimum distance
   * @param {number} [config.maxDistance] - Maximum distance
   * @param {number} [config.maxPolarAngle] - Maximum polar angle
   * @param {boolean} [config.autoRotate] - Whether to auto-rotate
   * @param {number} [config.autoRotateSpeed] - Auto-rotation speed
   */
  applyConfig(config) {
    Object.assign(this, config);
  }
}
