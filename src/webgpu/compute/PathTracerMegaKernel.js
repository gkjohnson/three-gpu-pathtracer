import { DataTexture, Matrix3, Matrix4, Vector2, StorageTexture } from 'three/webgpu';
import { ndcToCameraRay } from '../lib/wgsl/common.wgsl.js';
import { ComputeKernel } from './ComputeKernel.js';
import { texture, sampler, uniform, globalId, textureStore, wgslFn } from 'three/tsl';
import { pcgRand2, pcgRand3, pcgInit } from '../nodes/random.wgsl.js';
import { lambertBsdfFunc, sampleEnvironmentFn, weightedAlphaBlendFn } from '../nodes/sampling.wgsl.js';
import { proxy } from '../lib/nodes/NodeProxy.js';

export class PathTracerMegaKernel extends ComputeKernel {

	constructor() {

		const parameters = {
			bvhData: { value: null },

			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

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

			// compute variables
			globalId: globalId,
		};

		const shader = wgslFn( /* wgsl */`

			fn compute(

				// indices and target
				globalId: vec3u,
				prevOutputTarget: texture_storage_2d<rgba32float, read>,
				outputTarget: texture_storage_2d<rgba32float, write>,
				sampleCountTarget: texture_storage_2d<r32uint, read_write>,

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

			) -> void {

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
				let targetDimensions = textureDimensions( outputTarget );
				if ( indexUV.x >= targetDimensions.x || indexUV.y >= targetDimensions.y ) {

					return;

				}

				let uv = vec2f( indexUV ) / vec2f( targetDimensions );
				let ndc = uv * 2.0 - vec2f( 1.0 );

				pcgInitialize( indexUV, seed );

				// scene ray
				var jitter = 2.0 * ( pcgRand2() - vec2( 0.5 ) ) / vec2f( targetDimensions.xy );
				var ray = ndcToCameraRay( ndc + jitter, cameraToModelMatrix * inverseProjectionMatrix );
				ray.direction = normalize( ray.direction );

				var resultColor = vec4f( 0, 0, 0, 1 );
				var throughputColor = vec3f( 1.0 );

				for ( var bounce = 0u; bounce < bounces; bounce ++ ) {

					let hitResult = bvh_RaycastFirstHit( ray );
					if ( hitResult.didHit ) {

						let vertexData = bvh_sampleTrianglePoint( hitResult.barycoord, hitResult.indices.xyz );
						let hitPosition = ray.origin + ray.direction * hitResult.dist;
						let scatterRec = bsdfEval( normalize( vertexData.normal.xyz ), - ray.direction );

						let transform = bvh_transforms.value[ hitResult.objectIndex ];
						let material = bvh_materials.value[ transform.materialIndex ];

						// white diffuse surface
						throughputColor *= material.albedo * scatterRec.value / scatterRec.pdf;

						ray.origin = hitPosition;
						ray.direction = scatterRec.direction;

					} else {

						if ( bounce > 0u ) {

							resultColor = sampleEnvironment( envMap, envMapSampler, envInfo, ray.direction, pcgRand2() ) * vec4f( throughputColor, 1.0 );

						} else {

							resultColor = sampleEnvironment( background, backgroundSampler, backgroundInfo, ray.direction, pcgRand2() );

						}

						break;

					}

				}

				let sampleCount = textureLoad( sampleCountTarget, indexUV ).r + 1;
				let prevColor = textureLoad( prevOutputTarget, indexUV );
				let blendedColor = weightedAlphaBlend( prevColor, resultColor, 1.0 / f32( sampleCount ) );
				textureStore( sampleCountTarget, indexUV, vec4( sampleCount ) );
				textureStore( outputTarget, indexUV, blendedColor );

			}

		`, [
			proxy( 'bvhData.value.storage.materials', parameters ),
			proxy( 'bvhData.value.structs.material', parameters ),
			proxy( 'bvhData.value.structs.transform', parameters ),
			proxy( 'bvhData.value.fns.raycastFirstHit', parameters ),
			proxy( 'bvhData.value.fns.sampleTrianglePoint', parameters ),
			ndcToCameraRay, pcgRand2, pcgRand3, pcgInit, lambertBsdfFunc,
			sampleEnvironmentFn, weightedAlphaBlendFn,
		] );

		super( shader( parameters ) );

		this.defineUniformAccessors( parameters );

	}

}
