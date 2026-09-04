import { StorageBufferAttribute, StorageTexture, DataTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, textureStore, globalId, texture, sampler } from 'three/tsl';
import { rayQueueAtomicStruct, hitQueueStruct } from './structs.js';
import { SAMPLE_COUNT_MASK, SAMPLE_DISPATCHED_FLAG } from '../../constants.js';
import { proxy, proxyFn, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { weightedAlphaBlendFn } from '../../nodes/sampling.wgsl.js';
import { clampPathContributionFunc, isTerminatingScatterFunc, offsetRayOriginFunc } from '../../nodes/utils.wgsl.js';
import { rngInit, rand1, RNG_INDEX_RUSSIAN_ROULETTE, RNG_INDEX_ALPHA_TEST } from '../../nodes/random.wgsl.js';
import { applyDispersionFunc, dispersionColorWeightFunc, transmissionAttenuationFunc } from '../../nodes/material.wgsl.js';

export class ProcessHitsKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			bvhData: { value: null },
			material: { value: null },

			// targets
			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// settings
			smoothNormals: uniform( 1 ),
			bounces: uniform( 1 ),
			maxTransparentBounces: uniform( 5, 'uint' ),
			filterGlossy: uniform( 1 ),
			clampDirect: uniform( 0 ),
			clampIndirect: uniform( 10 ),

			// rays
			rayQueue: storage( new StorageBufferAttribute( 1, 1 ), rayQueueAtomicStruct ),
			hitQueue: storage( new StorageBufferAttribute( 1, 1 ), hitQueueStruct ),

			textures: texture( new DataTexture() ),
			textureSampler: sampler( new DataTexture() ),

			globalId: globalId,
		};

		const sampleTrianglePointFn = proxyFn( 'bvhData.value.fns.sampleTrianglePoint', params );
		const getSurfaceRecordFn = proxyFn( 'bvhData.value.fns.getSurfaceRecord', params );
		const bsdfSampleFn = proxyFn( 'material.value.bsdfSample', params );

		const fn = wgslTagFn/* wgsl */`

			fn compute(
				// settings
				smoothNormals: u32,
				bounces: u32,
				maxTransparentBounces: u32,
				filterGlossy: f32,
				clampDirect: f32,
				clampIndirect: f32,

				globalId: vec3u
			) -> void {

				let rayQueue = &${ params.rayQueue };
				let hitQueue = &${ params.hitQueue };

				let materials = &${ proxy( 'bvhData.value.storage.materials', params ) };
				let transforms = &${ proxy( 'bvhData.value.storage.transforms', params ) };

				// skip any rays invocations beyond the ray count
				let hitQueueCapacity = arrayLength( &hitQueue.elements );
				let hitIndex = ( globalId.x + hitQueue.start );
				if ( hitIndex >= hitQueue.end ) {

					return;

				}

				// get the ray info
				let input = hitQueue.elements[ hitIndex ];
				let indexUV = vec2u( input.pixel_x, input.pixel_y );
				${ rngInit }( indexUV.xy, input.seed, input.currentBounce + input.alphaDepth );

				let objectInfo = transforms[ input.objectIndex ];
				var materialInfo = materials[ objectInfo.materialIndex ];

				// a matte surface hit by the camera ray renders as a fully transparent
				let isMatte = materialInfo.matte != 0 && input.currentBounce == 0u;

				// apply per-object colors
				materialInfo.color *= objectInfo.color.rgb;
				materialInfo.opacity *= objectInfo.color.a;

				let barycoord = vec3( input.barycoord, 1.0 - input.barycoord.x - input.barycoord.y );
				var vertexData = ${ sampleTrianglePointFn }( barycoord, input.indices.xyz );
				vertexData.normal = normalize( transpose( objectInfo.inverseMatrixWorld ) * vertexData.normal );
				vertexData.tangent = vec4f( ( objectInfo.matrixWorld * vec4f( vertexData.tangent.xyz, 0.0 ) ).xyz, vertexData.tangent.w );
				vertexData.position = objectInfo.matrixWorld * vertexData.position;

				// blur glossy surfaces after low-probability bounces to suppress fireflies,
				// from the Cycles "filter glossy" approach in integrator/surface_shader.h
				// The smallest pdf seen along the path for the glossy filter is tracked below
				let blurRoughness = sqrt( clamp( 1.0 - filterGlossy * input.minPdf, 0.0, 1.0 ) ) * 0.5;

				var surface = ${ getSurfaceRecordFn }( materialInfo, vertexData, input.side, input.normal, input.view, blurRoughness );

				// Stochastically pass through partially transparent surfaces by re-enqueueing
				// the ray at the hit point, advancing the alpha depth but not the bounce count.
				let passesThrough = ${ rand1 }( ${ RNG_INDEX_ALPHA_TEST } ) > surface.opacity;
				if ( passesThrough && input.alphaDepth < maxTransparentBounces ) {

					let rayQueueCapacity = arrayLength( &rayQueue.elements );
					let index = atomicAdd( &rayQueue.end, 1 ) % rayQueueCapacity;
					rayQueue.elements[ index ].origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, - input.view, input.normal );
					rayQueue.elements[ index ].direction = - input.view;
					rayQueue.elements[ index ].pixel = indexUV;
					rayQueue.elements[ index ].throughputColor = input.throughputColor;
					rayQueue.elements[ index ].currentBounce = input.currentBounce;
					rayQueue.elements[ index ].resultColor = input.resultColor;
					rayQueue.elements[ index ].seed = input.seed;
					rayQueue.elements[ index ].transmissiveRay = input.transmissiveRay;
					rayQueue.elements[ index ].minPdf = input.minPdf;
					rayQueue.elements[ index ].alphaDepth = input.alphaDepth + 1u;
					rayQueue.elements[ index ].bsdfPdf = input.bsdfPdf;
					rayQueue.elements[ index ].dispersionWavelength = input.dispersionWavelength;
					return;

				}

				var throughputColor = input.throughputColor;
				var dispersionWavelength = input.dispersionWavelength;

				let isDispersive = materialInfo.dispersion > 0.0 && surface.ior > 1.0 && surface.transmission > 0.0 && ! surface.thinWall;
				if ( isDispersive ) {

					let wavelength = abs( dispersionWavelength );
					surface = ${ applyDispersionFunc }( surface, materialInfo.dispersion, wavelength );
					if ( dispersionWavelength < 0.0 ) {

						dispersionWavelength = wavelength;
						throughputColor *= ${ dispersionColorWeightFunc }( wavelength );

					}

				}

				let scatterRec = ${ bsdfSampleFn }( input.view, surface );

				// attenuate the light transmitted through the volume when exiting a backface
				if ( input.side < 0.0 && materialInfo.transmission > 0.0 ) {

					throughputColor *= ${ transmissionAttenuationFunc }( input.dist, materialInfo.attenuationColor, materialInfo.attenuationDistance );

				}

				// emission
				let emission = ${ clampPathContributionFunc }( throughputColor * surface.emission, input.currentBounce + 1u, clampDirect, clampIndirect );
				var resultColor = input.resultColor + vec4f( emission, 0.0 );
				if ( isMatte ) {

					resultColor = vec4f( 0.0 );

				}

				var isTerminated = isMatte || passesThrough || input.currentBounce >= bounces || ${ isTerminatingScatterFunc }( scatterRec );

				// russian roulette early out:
				// Matches Cycles path_state_continuation_probability in integrator/path_state.h
				if ( ! isTerminated && input.currentBounce >= 3u ) {

					let rrThroughput = throughputColor * scatterRec.color / scatterRec.pdf;
					let rrProb = saturate( sqrt( max( max( rrThroughput.r, rrThroughput.g ), rrThroughput.b ) ) );
					isTerminated = rrProb <= 0.0 || ${ rand1 }( ${ RNG_INDEX_RUSSIAN_ROULETTE } ) > rrProb;
					if ( ! isTerminated ) {

						throughputColor /= rrProb;

					}

				}

				if ( ! isTerminated ) {

					// only divide by the pdf if this ray is valid
					throughputColor *= scatterRec.color / scatterRec.pdf;

					// exit if our throughput is 0.0
					isTerminated = all( throughputColor == vec3f( 0.0 ) );

				}

				if ( isTerminated ) {

					// store the color rows top down to match a rasterized render target
					let colorIndex = vec2u( indexUV.x, textureDimensions( ${ params.outputTarget } ).y - 1u - indexUV.y );

					// terminate ray, write color, mark it as inactive
					let sampleCount = ( textureLoad( ${ params.sampleCountTarget }, indexUV ).r & ${ SAMPLE_COUNT_MASK }u ) + 1;
					let prevColor = textureLoad( ${ params.prevOutputTarget }, colorIndex );
					let blendedColor = ${ weightedAlphaBlendFn }( prevColor, resultColor, 1.0 / f32( sampleCount ) );
					textureStore( ${ params.sampleCountTarget }, indexUV, vec4( ${ SAMPLE_DISPATCHED_FLAG }u | sampleCount ) );
					textureStore( ${ params.outputTarget }, colorIndex, blendedColor );

				} else {

					let rayQueueCapacity = arrayLength( &rayQueue.elements );
					let index = atomicAdd( &rayQueue.end, 1 ) % rayQueueCapacity;
					rayQueue.elements[ index ].origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, scatterRec.direction, input.normal );
					rayQueue.elements[ index ].direction = scatterRec.direction;
					rayQueue.elements[ index ].pixel = indexUV;
					rayQueue.elements[ index ].throughputColor = throughputColor;
					rayQueue.elements[ index ].currentBounce = input.currentBounce + 1;
					rayQueue.elements[ index ].resultColor = resultColor;
					rayQueue.elements[ index ].seed = input.seed;
					rayQueue.elements[ index ].bsdfPdf = scatterRec.pdf;
					rayQueue.elements[ index ].transmissiveRay = select( 0u, input.transmissiveRay, scatterRec.isTransmissive );
					rayQueue.elements[ index ].minPdf = min( scatterRec.pdf, input.minPdf );
					rayQueue.elements[ index ].alphaDepth = input.alphaDepth;
					rayQueue.elements[ index ].dispersionWavelength = dispersionWavelength;

				}

			}`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
