import { wgslTagFn } from '../lib/nodes/WGSLTagFnNode';
import { lightRecordStruct, lightStruct } from './structs.wgsl';

export const LIGHT_TYPE_SPOT = 0;
export const LIGHT_TYPE_DIRECTIONAL = 1;
export const LIGHT_TYPE_POINT = 2;
export const LIGHT_TYPE_AREA_RECT = 3;
export const LIGHT_TYPE_AREA_CIRC = 4;
export const LIGHT_TYPE_ENVIRONMENT = 5;

export const sampleRandomLightFunc = wgslTagFn/* wgsl */`

	fn sampleRandomLight( u: f32, lights: ptr<storage, array<${ lightStruct }>> ) -> ${ lightRecordStruct } {

		var result: ${ lightRecordStruct };

		// TODO: explore for sophisticated strategies for light sample generation
		let lightCount = arrayLength( lights );
		let lightIndex = u32( u * f32( lightCount ) );
		let light = lights[ lightIndex ];

		if ( light.kind == ${ LIGHT_TYPE_DIRECTIONAL } ) {

			result.dist = 1e10; // TODO: const?
			result.direction = light.u;
			result.pdf = 1.0;
			result.emission = light.color * light.intensity;
			result.kind = light.kind;

		} else if ( light.kind == ${ LIGHT_TYPE_POINT } ) {

		} else if ( light.kind == ${ LIGHT_TYPE_SPOT } ) {

		}

		return result;

	}

`;
