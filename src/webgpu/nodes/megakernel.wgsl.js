import { wgslFn } from 'three/tsl';
import { ndcToCameraRay, bvhIntersectFirstHit, constants, getVertexAttribute } from 'three-mesh-bvh/webgpu';
import { pcgRand3, pcgInit } from './random.wgsl.js';
import { lambertBsdfFunc, getSurfaceRecordFunc, pbrtBsdfFunc } from './sampling.wgsl.js';
import { materialStruct, surfaceRecordStruct } from './structs.wgsl.js';

export const megakernelShader = ( bounces ) => wgslFn( /* wgsl */`

	fn compute(
		resultBuffer: ptr<storage, array<vec4f>, read_write>,
		offset: vec2u,
		tileSize: vec2u,
		dimensions: vec2u,
		smoothNormals: u32,
		inverseProjectionMatrix: mat4x4f,
		cameraToModelMatrix: mat4x4f,
		seed: u32,
		sample_count_buffer: ptr<storage, array<u32>, read_write>,

		geom_position: ptr<storage, array<vec3f>, read>,
		geom_index: ptr<storage, array<vec3u>, read>,
		geom_normals: ptr<storage, array<vec3f>, read>,
		geom_material_index: ptr<storage, array<u32>, read>,
		bvh: ptr<storage, array<BVHNode>, read>,

		materials: ptr<storage, array<Material>, read>,

		globalId: vec3u,
	) -> void {
		if ( globalId.x >= tileSize.x || globalId.y >= tileSize.y ) {
			return;
		}

		// to screen coordinates
		let indexUV = offset + globalId.xy;
		let uv = vec2f( indexUV ) / vec2f( dimensions );
		let ndc = uv * 2.0 - vec2f( 1.0 );

		pcgInitialize(indexUV, seed);

		// scene ray
		// TODO: sample a random ray
		var ray = ndcToCameraRay( ndc, cameraToModelMatrix * inverseProjectionMatrix );

		const bounces: u32 = ${bounces};
		var resultColor = vec3f( 0.0 );
		var throughputColor = vec3f( 1.0 );
		var sampleCount = 0u;
		// TODO: fix shadow acne? RTIOW says we could just ignore ray hits that are too close
		for (var bounce = 0u; bounce < bounces; bounce++) {
			let hitResult = bvhIntersectFirstHit( geom_index, geom_position, bvh, ray );

			// write result
			if ( hitResult.didHit ) {

				let material = materials[ geom_material_index[ hitResult.indices.x ] ];

				// TODO: Replace geom_normals with geom_uvs
				let surf = getSurfaceRecord( material, hitResult, geom_normals, geom_normals );

				let scatterRec = bsdfSample( - ray.direction, surf );

				// TODO: fix shadow acne?
				// let scatterRec = bsdfEval(hitResult.normal, - ray.direction);
				// if (bounce == 1) {
				// 	resultColor = vec3f( 0.0, 1.0, 0.0 ); //  dot( scatterRec.direction, hitNormal ) ); // ( vec3f( 1.0 ) + scatterRec.direction ) * 0.5;
				// 	sampleCount = 1;
				// 	break;
				// }

				if ( scatterRec.pdf <= 0.0 ) { // || ! isDirectionValid( scatterRec.direction, surf.normal, surf.faceNormal ) ) {

					break;

				}

				throughputColor *= scatterRec.color / scatterRec.pdf;

				ray.origin = ray.origin + ray.direction * hitResult.dist;
				ray.direction = scatterRec.direction;

			} else {

				let background = normalize( vec3f( 0.0366, 0.0813, 0.1057 ) );
				resultColor += background * throughputColor;
				sampleCount += 1;
				break;
			}

		}

		if ( sampleCount == 0 ) {
			return;
		}

		const accumulate: bool = true;

		let index = indexUV.x + indexUV.y * dimensions.x;

		let prevColor = resultBuffer[index];
		if ( accumulate ) {
			let prevSampleCount = sample_count_buffer[index];
			let newSampleCount = prevSampleCount + sampleCount;
			sample_count_buffer[index] = newSampleCount;

			let newColor = ( ( prevColor.xyz * f32( prevSampleCount ) ) + resultColor ) / f32( newSampleCount );
			resultBuffer[index] = vec4f( newColor, 1.0 );
		} else {
			resultBuffer[index] = vec4f( resultColor.xyz / f32( sampleCount ), 1.0 );
		}

	}
`, [ getSurfaceRecordFunc, ndcToCameraRay, bvhIntersectFirstHit, constants, getVertexAttribute, materialStruct, surfaceRecordStruct, pcgRand3, pcgInit, pbrtBsdfFunc ] );

export default megakernelShader;
