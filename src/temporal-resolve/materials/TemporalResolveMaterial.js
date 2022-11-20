﻿import { Matrix4 } from 'three';
import { MaterialBase } from '../../materials/MaterialBase.js';
import { fragmentShader } from './shaders/temporalResolveFragment.js';
import { vertexShader } from './shaders/temporalResolveVertex.js';

export class TemporalResolveMaterial extends MaterialBase {

	constructor() {

		super( {
			type: 'TemporalResolveMaterial',
			uniforms: {
				samplesTexture: { value: null },
				accumulatedSamplesTexture: { value: null },
				velocityTexture: { value: null },
				lastVelocityTexture: { value: null },
				depthTexture: { value: null },
				lastDepthTexture: { value: null },
				samples: { value: 0 },
				temporalResolveMix: { value: 0 },
				clampRadius: { value: 0 },
				newSamplesSmoothing: { value: 0 },
				newSamplesCorrection: { value: 0 },
				tileCount: { value: 0 },
				curInverseProjectionMatrix: { value: new Matrix4() },
				curCameraMatrixWorld: { value: new Matrix4() },
				prevInverseProjectionMatrix: { value: new Matrix4() },
				prevCameraMatrixWorld: { value: new Matrix4() },
				cameraNear: { value: 0 },
				cameraFar: { value: 0 },
			},
			defines: {
				DILATION: '',
				WEIGHT_TRANSFORM: '1.0'
			},
			vertexShader,
			fragmentShader,
		} );

	}

}
