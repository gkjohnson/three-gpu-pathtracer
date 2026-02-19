import { wgslFn } from 'three/tsl';
import { ndcToCameraRay, bvhIntersectFirstHit, constants, getVertexAttribute } from 'three-mesh-bvh/webgpu';
import { pcgRand3, pcgInit } from './random.wgsl.js';
import { getSurfaceRecordFunc, lambertBsdfFunc, pbrtBsdfFunc } from './material.wgsl.js';
import { materialStruct, surfaceRecordStruct } from './structs.wgsl.js';

export const megakernelShader = wgslFn( /* wgsl */`

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
		smoothNormals: u32,
		inverseProjectionMatrix: mat4x4f,
		cameraToModelMatrix: mat4x4f,
		seed: u32,
		bounces: u32,

		// scene
		geom_position: ptr<storage, array<vec3f>, read>,
		geom_index: ptr<storage, array<vec3u>, read>,
		geom_attributes: ptr<storage, array<VertexAttributes>, read>,
		geom_material_index: ptr<storage, array<u32>, read>,
		bvh: ptr<storage, array<BVHNode>, read>,

		materials: ptr<storage, array<Material>, read>,

	) -> void {

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
		// TODO: jittering the ray by [-1, 1] seems to look better but is larger than a pixel?
		var jitter = 2.0 * ( pcgRand2() - vec2( 0.5 ) ) / vec2f( targetDimensions.xy );
		var ray = ndcToCameraRay( ndc + jitter, cameraToModelMatrix * inverseProjectionMatrix );

		var resultColor = vec3f( 0.0 );
		var throughputColor = vec3f( 1.0 );

		// TODO: fix shadow acne? RTIOW says we could just ignore ray hits that are too close
		for ( var bounce = 0u; bounce < bounces; bounce ++ ) {

			let hitResult = bvhIntersectFirstHit( geom_index, geom_position, bvh, ray );

			// write result
			if ( hitResult.didHit ) {

				let material = materials[ geom_material_index[ hitResult.indices.x ] ];

				let hitPosition = getVertexAttribute( hitResult.barycoord, hitResult.indices.xyz, geom_position );

				let surf = getSurfaceRecord( material, hitResult, geom_attributes );

				let scatterRec = bsdfSample( - ray.direction, surf );

				if ( scatterRec.pdf <= 0.0 || any( scatterRec.color != scatterRec.color ) ) {

					return;

				}

				throughputColor *= scatterRec.color / scatterRec.pdf;

				ray.origin = hitPosition;
				ray.direction = scatterRec.direction;

			} else {

				let background = vec3f( 0.5 );
				resultColor += background * throughputColor;
				break;

			}

		}

		let sampleCount = textureLoad( sampleCountTarget, indexUV ).r + 1;
		var color = textureLoad( prevOutputTarget, indexUV ).xyz;
		color += ( resultColor - color.xyz ) / f32( sampleCount );

		textureStore( sampleCountTarget, indexUV, vec4( sampleCount ) );
		textureStore( outputTarget, indexUV, vec4( color, 1.0 ) );

	}
`, [
	getSurfaceRecordFunc,
	ndcToCameraRay,
	bvhIntersectFirstHit,
	constants,
	getVertexAttribute,
	materialStruct,
	surfaceRecordStruct,
	pcgRand3,
	pcgInit,
	// lambertBsdfFunc,
	pbrtBsdfFunc,
] );

export default megakernelShader;
