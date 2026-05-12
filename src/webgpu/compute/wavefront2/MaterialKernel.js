import { ndcToCameraRay } from 'three-mesh-bvh/webgpu';
import { wgslTagFn } from '../../lib/nodes/WGSLTagFnNode';
import { SOBOL_INDEX_RAY_JITTER, sobolFuncs, sobolInit } from '../../nodes/random.wgsl';
import { ComputeKernel } from '../ComputeKernel';
import { globalId, sampler, storage, texture, uniform } from 'three/tsl';
import { DataTexture, Matrix4, Vector2 } from 'three';
import { proxy, proxyFn } from '../../lib/nodes/NodeProxy';
import { getSurfaceRecordFunc, transmissionAttenuationFunc } from '../../nodes/material.wgsl';
import { rayStruct } from '../../lib/wgsl/structs.wgsl';
import { StorageBufferAttribute } from 'three/webgpu';
import { pixelQueueStruct, rayDataStruct, rayQueueStruct } from './structs';

const FILTER_GLOSSY = 1.0;

export class MaterialKernel extends ComputeKernel {

	constructor() {

		const params = {
			bvhData: { value: null },
			material: { value: null },

			rayData: storage( new StorageBufferAttribute(), rayDataStruct ),
			rayQueue: storage( new StorageBufferAttribute(), rayQueueStruct ),
			shadowRayQueue: storage( new StorageBufferAttribute(), rayQueueStruct ),
			pixelQueue: storage( new StorageBufferAttribute(), pixelQueueStruct ),

			cameraToModelMatrix: uniform( new Matrix4() ),
			inverseProjectionMatrix: uniform( new Matrix4() ),

			seed: uniform( 0 ),
			bounces: uniform( 0 ),
			targetDimensions: uniform( new Vector2() ),

			textures: texture( new DataTexture() ),
			textureSampler: sampler( new DataTexture() ),

			globalId: globalId,

		};

		const sampleTrianglePointFn = proxyFn( 'bvhData.value.fns.sampleTrianglePoint', params );
		const bsdfSampleFn = proxyFn( 'material.value.bsdfSample', params );
		const bsdfEvalScatterFn = proxyFn( 'material.value.bsdfEvalScatter', params );

		const fn = wgslTagFn/* wgsl */`

			fn material(
				cameraToModelMatrix: mat4x4f,
				inverseProjectionMatrix: mat4x4f,

				// settings
				seed: u32,
				bounces: u32,
				targetDimensions: vec2u,

				textures: texture_2d_array<f32>,
				textureSampler: sampler,

				globalId: vec3u,

			) -> void {
				let transforms = &${ proxy( 'bvhData.value.storage.transforms', params ) };
				let materials = &${ proxy( 'bvhData.value.storage.materials', params ) };

				let index = globalId.x;
				if ( index >= arrayLength( &${ params.rayData } ) ) {

					return;

				}

				let data = &${ params.rayData }[ index ];

				let objectIndex = data.objectIndex;

				if ( objectIndex < 0 ) {

					// generate new camera extension ray
					var pixelIndex = data.pixelIndex;
					if ( ${ params.pixelQueue }.elementCount > 0 ) {

						// This could be bad and create contention on low pixel queue sizes
						let queueSize = arrayLength( &${ params.pixelQueue }.elements );
						let slot = atomicAdd( &${ params.pixelQueue }.current, 1u ) % queueSize;
						pixelIndex = atomicExchange( &${ params.pixelQueue }.elements[ slot ], pixelIndex );

					}

					${ sobolInit }( pixelIndex, seed, 0 );

					// write the ray data
					var jitter = 2.0 * ${ sobolFuncs[ 2 ] }( ${ SOBOL_INDEX_RAY_JITTER } ) / vec2f( targetDimensions );
					let indexUV = vec2u( pixelIndex >> 16, pixelIndex & 0xFFFF );
					let uv = vec2f( indexUV ) / vec2f( targetDimensions );
					let ndc = uv * 2.0 - vec2f( 1.0 );
					var ray = ${ ndcToCameraRay }( ndc + jitter, cameraToModelMatrix * inverseProjectionMatrix );
					ray.direction = normalize( ray.direction );
					let rayIndex = atomicAdd( &${ params.rayQueue }.length, 1 );
					${ params.rayQueue }.elements[ rayIndex ] = ray;

					data.throughputColor = vec3f( 1.0 );
					data.resultColor = vec4f( 0.0, 0.0, 0.0, 1.0 );
					data.bsdf = vec3f( 1.0 );
					data.attenuation = vec3f( 1.0 );
					data.emission = vec3f( 0.0 );
					data.currentBounce = 0;
					data.pixelIndex = pixelIndex;
					data.shadowRayIntersectionIndex = -1;
					data.direction = ray.direction;
					data.rayIntersectionIndex = i32( rayIndex );
					data.minPdf = 1.0;
					data.pdf = 1.0;

				} else {

					// process data
					let object = transforms[ objectIndex ];
					var material = materials[ object.materialIndex ];

					// apply per-object colors
					material.color *= object.color.rgb;
					material.opacity *= object.color.a;

					let side = all( data.barycoord >= vec3f( 0.0 ) );

					if ( !side ) {

						data.attenuation = ${ transmissionAttenuationFunc }( data.dist, material.attenuationColor, material.attenuationDistance );

					} else {

						data.attenuation = vec3f( 1.0 );

					}
					var vertexData = ${ sampleTrianglePointFn }( abs( data.barycoord ), data.indices.xyz );
					vertexData.normal = normalize( transpose( object.inverseMatrixWorld ) * vertexData.normal );
					vertexData.position = object.matrixWorld * vertexData.position;

					let blurRoughness = sqrt( clamp( 1.0 - ${ FILTER_GLOSSY } * data.minPdf, 0.0, 1.0 ) ) * 0.5;

					let surface = ${ getSurfaceRecordFunc }(
						material, vertexData, side, vertexData.normal.xyz, // Replace normal w/ geometric normal
						blurRoughness, textures, textureSampler
					);

					let incidentDirection = data.direction;

					${ sobolInit }( data.pixelIndex, seed, data.currentBounce );
					data.currentBounce += 1;

					let scatterRec = ${ bsdfSampleFn }( - incidentDirection, surface );
					data.bsdf = scatterRec.color;
					data.pdf = scatterRec.pdf;
					data.direction = scatterRec.direction;
					data.emission = surface.emission;

					let offsetDir = vertexData.normal.xyz * sign( dot( vertexData.normal.xyz, scatterRec.direction ) );
					let newPoint = vertexData.position.xyz + 1e-3 * offsetDir;

					let rayIndex = atomicAdd( &${ params.rayQueue }.length, 1 );
					${ params.rayQueue }.elements[ rayIndex ] = ${ rayStruct }( newPoint, scatterRec.direction );
					data.rayIntersectionIndex = i32( rayIndex );

					let lightScatterRec = ${ bsdfEvalScatterFn }( - incidentDirection, data.lightDirection, surface );
					data.lightBsdf = lightScatterRec.color;
					data.lightBsdfPdf = lightScatterRec.pdf;

					let shadowRayIndex = atomicAdd( &${ params.shadowRayQueue }.length, 1 );
					${ params.shadowRayQueue }.elements[ shadowRayIndex ] = ${ rayStruct }( newPoint, data.lightDirection );
					data.shadowRayIntersectionIndex = i32( shadowRayIndex );

				}

			}

		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
