import { Matrix4, ShaderMaterial } from "three";
import { fragmentShader } from "./shaders/temporalResolveFragment";
import { vertexShader } from "./shaders/temporalResolveVertex";

export class TemporalResolveMaterial extends ShaderMaterial {
	constructor() {
		super({
			type: "TemporalResolveMaterial",
			uniforms: {
				inputTexture: { value: null },
				samplesTexture: { value: null },
				accumulatedSamplesTexture: { value: null },
				velocityTexture: { value: null },
				depthTexture: { value: null },
				lastDepthTexture: { value: null },
				samples: { value: 0 },
				temporalResolveMix: { value: 0 },
				clampRadius: { value: 0 },
				newSamplesSmoothing: { value: 0 },
				newSamplesCorrection: { value: 0 },
				curInverseProjectionMatrix: { value: new Matrix4() },
				curCameraMatrixWorld: { value: new Matrix4() },
				prevInverseProjectionMatrix: { value: new Matrix4() },
				prevCameraMatrixWorld: { value: new Matrix4() },
				cameraNear: { value: 0 },
				cameraFar: { value: 0 },
			},
			vertexShader,
			fragmentShader,
		});
	}
}
