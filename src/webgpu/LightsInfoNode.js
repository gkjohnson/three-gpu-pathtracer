import { texture, uniform } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { LightsInfoUniformStruct } from '../uniforms/LightsInfoUniformStruct.js';
import { lightStruct, lightRecordStruct } from './nodes/structs.wgsl.js';
import {
	lightConstants,
	intersectsRectangleFn,
	intersectsCircleFn,
	randomAreaLightSampleFn,
	randomSpotLightSampleFn,
} from './nodes/lights.wgsl.js';

export class LightsInfoNode extends LightsInfoUniformStruct {

	constructor() {

		super();

		this.texNode = texture( this.tex );
		this.countNode = uniform( this.count, 'uint' );

		this._initFns();

	}

	updateFrom( lights, iesTextures = [] ) {

		const changed = super.updateFrom( lights, iesTextures );

		this.texNode.value = this.tex;
		this.countNode.value = this.count;

		return changed;

	}

	_initFns() {

		const { texNode, countNode } = this;

		// unpack a single light from the data texture
		const readLightInfo = wgslTagFn/* wgsl */`
			fn readLightInfo( index: u32 ) -> ${ lightStruct } {

				${ [ lightConstants ] }
				let width = textureDimensions( ${ texNode } ).x;
				let base = index * 6u;

				let s0 = textureLoad( ${ texNode }, vec2u( ( base + 0u ) % width, ( base + 0u ) / width ), 0 );
				let s1 = textureLoad( ${ texNode }, vec2u( ( base + 1u ) % width, ( base + 1u ) / width ), 0 );
				let s2 = textureLoad( ${ texNode }, vec2u( ( base + 2u ) % width, ( base + 2u ) / width ), 0 );
				let s3 = textureLoad( ${ texNode }, vec2u( ( base + 3u ) % width, ( base + 3u ) / width ), 0 );

				var l: ${ lightStruct };
				l.position = s0.rgb;
				l.lightType = i32( round( s0.a ) );
				l.color = s1.rgb;
				l.intensity = s1.a;
				l.u = s2.rgb;
				l.v = s3.rgb;
				l.area = s3.a;

				if ( l.lightType == SPOT_LIGHT_TYPE || l.lightType == POINT_LIGHT_TYPE ) {

					let s4 = textureLoad( ${ texNode }, vec2u( ( base + 4u ) % width, ( base + 4u ) / width ), 0 );
					let s5 = textureLoad( ${ texNode }, vec2u( ( base + 5u ) % width, ( base + 5u ) / width ), 0 );
					l.radius = s4.r;
					l.decay = s4.g;
					l.distance = s4.b;
					l.coneCos = s4.a;
					l.penumbraCos = s5.r;
					l.iesProfile = i32( round( s5.g ) );

				} else {

					l.radius = 0.0;
					l.decay = 0.0;
					l.distance = 0.0;
					l.coneCos = 0.0;
					l.penumbraCos = 0.0;
					l.iesProfile = - 1;

				}

				return l;

			}
		`;

		// uniformly pick a light and sample it
		this.randomLightSample = wgslTagFn/* wgsl */`
			fn randomLightSample( rayOrigin: vec3f, ruv: vec3f ) -> ${ lightRecordStruct } {

				${ [ lightConstants ] }
				let count = ${ countNode };
				let l = min( u32( ruv.x * f32( count ) ), count - 1u );
				let light = ${ readLightInfo }( l );

				var result: ${ lightRecordStruct };
				if ( light.lightType == SPOT_LIGHT_TYPE ) {

					result = ${ randomSpotLightSampleFn }( light, rayOrigin, ruv.yz );

				} else if ( light.lightType == POINT_LIGHT_TYPE ) {

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

				} else if ( light.lightType == DIR_LIGHT_TYPE ) {

					// the directional light's direction is packed into the u slot
					result.dist = LIGHT_FAR_DISTANCE;
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

				${ [ lightConstants ] }
				let light = ${ readLightInfo }( index );

				var u = light.u;
				var v = light.v;
				let normal = normalize( cross( u, v ) );

				// only front-facing area lights can be hit
				if ( dot( normal, rayDirection ) > 0.0 ) {

					u *= 1.0 / dot( u, u );
					v *= 1.0 / dot( v, v );

					var dist = - 1.0;
					if ( light.lightType == RECT_AREA_LIGHT_TYPE ) {

						dist = ${ intersectsRectangleFn }( light.position, normal, u, v, rayOrigin, rayDirection );

					} else if ( light.lightType == CIRC_AREA_LIGHT_TYPE ) {

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
