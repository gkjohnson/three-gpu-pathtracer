import { DataTexture, Matrix3, Matrix4, Vector2, StorageTexture } from 'three/webgpu';
import { ndcToCameraRay } from '../lib/wgsl/common.wgsl.js';
import { ComputeKernel } from './ComputeKernel.js';
import { texture, sampler, uniform, globalId, textureStore, wgsl, wgslFn } from 'three/tsl';
import { pcgRand2, pcgInit } from '../nodes/random.wgsl.js';
import { getSurfaceRecordFunc, lambertBsdfFunc } from '../nodes/material.wgsl.js';
import { sampleEnvironmentFn, weightedAlphaBlendFn } from '../nodes/sampling.wgsl.js';
import { proxy, proxyFn } from '../lib/nodes/NodeProxy.js';
import { wgslTagFn } from '../lib/nodes/WGSLTagFnNode.js';

export class PathTracerMegaKernel extends ComputeKernel {

	constructor() {

		const params = {
			bvhData: { value: null },

			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),
			compensationTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			offset: uniform( new Vector2() ),
			tileSize: uniform( new Vector2() ),
			seed: uniform( 0 ),
			bounces: uniform( 5 ),

			// transforms
			inverseProjectionMatrix: uniform( new Matrix4() ),
			cameraToModelMatrix: uniform( new Matrix4() ),

			// environment
			envMap: texture( new DataTexture() ),
			envMapSampler: sampler( new DataTexture() ),
			envMapRotation: uniform( new Matrix3() ),
			envMapIntensity: uniform( 1 ),

			background: texture( new DataTexture() ),
			backgroundSampler: sampler( new DataTexture() ),
			backgroundRotation: uniform( new Matrix3() ),
			backgroundIntensity: uniform( 1 ),
			backgroundBlurriness: uniform( 0 ),

			textures: texture( new DataTexture() ),
			textureSampler: sampler( new DataTexture() ),

			// compute variables
			globalId: globalId,
		};

		const raycastFirstHitFn = proxyFn( 'bvhData.value.fns.raycastFirstHit', params );
		const sampleTrianglePointFn = proxyFn( 'bvhData.value.fns.sampleTrianglePoint', params );

		const unpackCompensationFn = wgslFn( /* wgsl */`
			fn unpackCompensation( packed: u32, scale: vec4f ) -> vec4f {

				// FP16 has 10 mantissa bits so 2^-10 * 0.5 = 2^-11 = 1 / 2048 relative rounding error
				// 127 maps the value to a signed 8 bit range
				const COMP_SCALE = 127.0 * 2048.0;
				let raw = vec4f(
					f32( ( packed >> 0u ) & 0xFFu ),
					f32( ( packed >> 8u ) & 0xFFu ),
					f32( ( packed >> 16u ) & 0xFFu ),
					f32( ( packed >> 24u ) & 0xFFu )
				) - 128.0;

				// scale the value by the input color to accommodate relative error differences
				return ( raw / COMP_SCALE ) * scale;

			}
		` );

		const packCompensationFn = wgslFn( /* wgsl */`
			fn packCompensation( compensation: vec4f, scale: vec4f ) -> u32 {

				const COMP_SCALE = 127.0 * 2048.0;

				// avoid divide by zero
				let safeScale = select( scale, vec4f( 1.0 ), scale == vec4f( 0.0 ) );

				// undo the above packing calculation, clamping to be safe
				var quantized = ( compensation / safeScale ) * COMP_SCALE + 128.0;
				quantized = clamp( quantized, vec4f( 0.0 ), vec4f( 255.0 ) );

				// pack all the channels
				return u32(
					( u32( quantized.r ) << 0u ) |
					( u32( quantized.g ) << 8u ) |
					( u32( quantized.b ) << 16u ) |
					( u32( quantized.a ) << 24u )
				);

			}
		` );

		const shader = wgslTagFn/* wgsl */`

			${ [ unpackCompensationFn, packCompensationFn ] }

			fn compute(

				// indices and target
				globalId: vec3u,

				// tiles
				offset: vec2u,
				tileSize: vec2u,

				// settings
				inverseProjectionMatrix: mat4x4f,
				cameraToModelMatrix: mat4x4f,
				seed: u32,
				bounces: u32,

				// environment
				envMap: texture_2d<f32>,
				envMapSampler: sampler,
				envMapRotation: mat3x3f,
				envMapIntensity: f32,

				background: texture_2d<f32>,
				backgroundSampler: sampler,
				backgroundRotation: mat3x3f,
				backgroundIntensity: f32,
				backgroundBlurriness: f32,

				textures: texture_2d_array<f32>,
				textureSampler: sampler

			) -> void {

				let transforms = &${ proxy( 'bvhData.value.storage.transforms', params ) };
				let materials = &${ proxy( 'bvhData.value.storage.materials', params ) };

				let envInfo = EnvironmentInfo(
					envMapRotation,
					envMapIntensity,
					0.0 // blur,
				);

				let backgroundInfo = EnvironmentInfo(
					backgroundRotation,
					backgroundIntensity,
					backgroundBlurriness,
				);

				// make sure we don't bleed over the edge of our tile
				if ( globalId.x >= tileSize.x || globalId.y >= tileSize.y ) {

					return;

				}

				// to screen coordinates
				let indexUV = offset + globalId.xy;
				let targetDimensions = textureDimensions( ${ params.outputTarget } );
				if ( indexUV.x >= targetDimensions.x || indexUV.y >= targetDimensions.y ) {

					return;

				}

				let uv = vec2f( indexUV ) / vec2f( targetDimensions );
				let ndc = uv * 2.0 - vec2f( 1.0 );

				${ pcgInit }( indexUV, seed );

				// scene ray
				var jitter = 2.0 * ${ pcgRand2 }() / vec2f( targetDimensions.xy );
				var ray = ${ ndcToCameraRay }( ndc + jitter, cameraToModelMatrix * inverseProjectionMatrix );
				ray.direction = normalize( ray.direction );

				var resultColor = vec4f( 0, 0, 0, 1 );
				var throughputColor = vec3f( 1.0 );

				for ( var bounce = 0u; bounce < bounces; bounce ++ ) {

					let hitResult = ${ raycastFirstHitFn }( ray );
					if ( hitResult.didHit ) {

						let object = transforms[ hitResult.objectIndex ];
						var material = materials[ object.materialIndex ];

						// apply per-object colors
						material.color *= object.color.rgb;
						material.opacity *= object.color.a;

						var vertexData = ${ sampleTrianglePointFn }( hitResult.barycoord, hitResult.indices.xyz );
						vertexData.normal = normalize( transpose( object.inverseMatrixWorld ) * vertexData.normal );
						vertexData.position = object.matrixWorld * vertexData.position;

						let surface = ${ getSurfaceRecordFunc }( material, vertexData, hitResult.side, hitResult.normal, textures, textureSampler );

						let scatterRec = ${ lambertBsdfFunc }( - ray.direction, surface );

						// white diffuse surface
						throughputColor *= scatterRec.color / scatterRec.pdf;

						ray.origin = vertexData.position.xyz;
						ray.direction = scatterRec.direction;

					} else {

						if ( bounce > 0u ) {

							resultColor = ${ sampleEnvironmentFn }( envMap, envMapSampler, envInfo, ray.direction, pcgRand2() ) * vec4f( throughputColor, 1.0 );

						} else {

							resultColor = ${ sampleEnvironmentFn }( background, backgroundSampler, backgroundInfo, ray.direction, pcgRand2() );

						}

						break;

					}

				}

				// Kahan-compensated running mean: recover true mean before computing delta
				let prevColor = textureLoad( ${ params.prevOutputTarget }, indexUV );
				let packedComp = textureLoad( ${ params.compensationTarget }, indexUV ).r;
				let compensation = ${ unpackCompensationFn }( packedComp, prevColor );
				let sampleCount = textureLoad( ${ params.sampleCountTarget }, indexUV ).r + 1;
				let blendedColor = ${ weightedAlphaBlendFn }( prevColor + compensation, resultColor, 1.0 / f32( sampleCount ) );

				// simulate FP16 rounding via pack/unpack to compute the residual that will be lost at store
				let storedColor = quantizeToF16( blendedColor );
				let newPackedComp = ${ packCompensationFn }( blendedColor - storedColor, storedColor );

				textureStore( ${ params.sampleCountTarget }, indexUV, vec4( sampleCount ) );
				textureStore( ${ params.outputTarget }, indexUV, storedColor );
				textureStore( ${ params.compensationTarget }, indexUV, vec4u( newPackedComp ) );

			}`;

		super( shader( params ) );

		this.defineUniformAccessors( params );

	}

}
