import { storage, uniform } from 'three/tsl';
import { StorageBufferAttribute } from 'three/webgpu';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { LightsInfoUniformStruct } from '../uniforms/LightsInfoUniformStruct.js';
import { lightStruct, lightRecordStruct } from './nodes/structs.wgsl.js';
import {
	RECT_AREA_LIGHT_TYPE,
	CIRC_AREA_LIGHT_TYPE,
	SPOT_LIGHT_TYPE,
	DIR_LIGHT_TYPE,
	POINT_LIGHT_TYPE,
	LIGHT_FAR_DISTANCE,
	intersectsRectangleFn,
	intersectsCircleFn,
	randomAreaLightSampleFn,
	randomSpotLightSampleFn,
} from './nodes/lights.wgsl.js';

export class LightsInfoNode extends LightsInfoUniformStruct {

	constructor() {

		super();

		// lights packed into a storage buffer of Light structs, read directly as lights[ i ]. The buffer
		// is resized in place to the exact light count on update; the binding node stays stable so no
		// pipeline rebuild is needed.
		this.countNode = uniform( this.count, 'uint' );
		this._resizeBuffer( 2 );
		this._initFns();

	}

	_resizeBuffer( lightCapacity ) {

		const stride = lightStruct.getLength();
		this.buffer = new StorageBufferAttribute( new Float32Array( lightCapacity * stride ), stride );
		this.bufferNode = storage( this.buffer, lightStruct ).toReadOnly().setName( 'lights' );

	}

	updateFrom( lights, iesTextures = [] ) {

		const changed = super.updateFrom( lights, iesTextures );

		const stride = lightStruct.getLength();
		const count = this.count;
		const capacity = Math.max( count, 2 );

		// resize the buffer in place to the exact light count. Storage arrays are runtime-sized in WGSL
		// and the loop bound comes from countNode, so this needs no pipeline rebuild — just a buffer
		// reallocation + re-upload, keeping the same binding node.
		if ( this.buffer.array.length !== capacity * stride ) {

			this.buffer.array = new Float32Array( capacity * stride );

		}

		// the texture's packed float layout already matches lightStruct's std layout, so copy it in
		const src = this.tex.image.data;
		this.buffer.array.set( src.subarray( 0, count * stride ) );

		// lightType ( float offset 3 ) and iesProfile ( offset 21 ) are stored as float values in the
		// texture; rewrite them as i32 bits to match lightStruct's int fields
		const intView = new Int32Array( this.buffer.array.buffer );
		for ( let i = 0; i < count; i ++ ) {

			const base = i * stride;
			intView[ base + 3 ] = Math.round( src[ base + 3 ] );
			intView[ base + 21 ] = Math.round( src[ base + 21 ] );

		}

		this.buffer.needsUpdate = true;
		this.countNode.value = this.count;

		return changed;

	}

	_initFns() {

		const { bufferNode, countNode } = this;

		// read a single light directly from the storage buffer as a Light struct
		const readLightInfo = wgslTagFn/* wgsl */`
			fn readLightInfo( index: u32 ) -> ${ lightStruct } {

				let lights = &${ bufferNode };
				return lights[ index ];

			}
		`;

		// uniformly pick a light and sample it
		this.randomLightSample = wgslTagFn/* wgsl */`
			fn randomLightSample( rayOrigin: vec3f, ruv: vec3f ) -> ${ lightRecordStruct } {

				let count = ${ countNode };
				let l = min( u32( ruv.x * f32( count ) ), count - 1u );
				let light = ${ readLightInfo }( l );

				var result: ${ lightRecordStruct };
				if ( light.lightType == ${ SPOT_LIGHT_TYPE } ) {

					result = ${ randomSpotLightSampleFn }( light, rayOrigin, ruv.yz );

				} else if ( light.lightType == ${ POINT_LIGHT_TYPE } ) {

					// the point light's world position is packed into the u slot
					let lightRay = light.u - rayOrigin;
					let lightDist = length( lightRay );
					let cutoffDistance = light.distance;
					var distanceFalloff = 1.0 / max( pow( lightDist, light.decay ), 0.01 );
					if ( cutoffDistance > 0.0 ) {

						let window = clamp( 1.0 - pow( lightDist / cutoffDistance, 4.0 ), 0.0, 1.0 );
						distanceFalloff *= window * window;

					}

					result.direction = normalize( lightRay );
					result.dist = lightDist;
					result.pdf = 1.0;
					result.emission = light.color * light.intensity * distanceFalloff;
					result.lightType = light.lightType;

				} else if ( light.lightType == ${ DIR_LIGHT_TYPE } ) {

					// the directional light's direction is packed into the u slot
					result.dist = ${ LIGHT_FAR_DISTANCE };
					result.direction = light.u;
					result.pdf = 1.0;
					result.emission = light.color * light.intensity;
					result.lightType = light.lightType;

				} else {

					result = ${ randomAreaLightSampleFn }( light, rayOrigin, ruv.yz );

				}

				return result;

			}
		`;

		// forward intersection of a ray with a single area light (rect / circ only), used for
		// MIS when a bsdf-sampled ray happens to hit a light ( mirrors intersectLightAtIndex ).
		this.intersectLightAtIndex = wgslTagFn/* wgsl */`
			fn intersectLightAtIndex( rayOrigin: vec3f, rayDirection: vec3f, index: u32, lightRec: ptr<function, ${ lightRecordStruct }> ) -> bool {

				let light = ${ readLightInfo }( index );

				var u = light.u;
				var v = light.v;
				let normal = normalize( cross( u, v ) );

				// only front-facing area lights can be hit
				if ( dot( normal, rayDirection ) > 0.0 ) {

					u *= 1.0 / dot( u, u );
					v *= 1.0 / dot( v, v );

					var dist = - 1.0;
					if ( light.lightType == ${ RECT_AREA_LIGHT_TYPE } ) {

						dist = ${ intersectsRectangleFn }( light.position, normal, u, v, rayOrigin, rayDirection );

					} else if ( light.lightType == ${ CIRC_AREA_LIGHT_TYPE } ) {

						dist = ${ intersectsCircleFn }( light.position, normal, u, v, rayOrigin, rayDirection );

					}

					if ( dist > 0.0 ) {

						let cosTheta = dot( rayDirection, normal );
						lightRec.dist = dist;
						lightRec.pdf = ( dist * dist ) / ( light.area * cosTheta );
						lightRec.emission = light.color * light.intensity;
						lightRec.direction = rayDirection;
						lightRec.lightType = light.lightType;
						return true;

					}

				}

				return false;

			}
		`;

	}

	dispose() {

		this.tex.dispose();

	}

}
