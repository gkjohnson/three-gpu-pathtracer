import { wgslFn } from 'three/tsl';
import { ndcToCameraRay, bvhIntersectFirstHit, constants, getVertexAttribute } from 'three-mesh-bvh/webgpu';
import { pcgRand3, pcgInit } from './random.wgsl.js';
import { lambertBsdfFunc } from './sampling.wgsl.js';
import { materialStruct, surfaceRecordStruct } from './structs.wgsl.js';

export const megakernelShader = wgslFn( /* wgsl */`

	fn compute(

		// indices and target
		globalId: vec3u,
		outputTarget: texture_storage_2d<rgba32float, read_write>,
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
		geom_normals: ptr<storage, array<vec3f>, read>,
		geom_material_index: ptr<storage, array<u32>, read>,
		bvh: ptr<storage, array<BVHNode>, read>,

		materials: ptr<storage, array<Material>, read>,

	) -> void {

		// TODO: this needs to early out only if it's beyond the extends of the buffer
		if ( globalId.x >= tileSize.x || globalId.y >= tileSize.y ) {
			return;
		}

		// to screen coordinates
		let indexUV = offset + globalId.xy;
		let targetDimensions = textureDimensions( outputTarget );
		let uv = vec2f( indexUV ) / vec2f( targetDimensions );
		let ndc = uv * 2.0 - vec2f( 1.0 );

		pcgInitialize(indexUV, seed);

		// scene ray
		// TODO: sample a random ray
		var ray = ndcToCameraRay( ndc, cameraToModelMatrix * inverseProjectionMatrix );

		var resultColor = vec3f( 0.0 );
		var throughputColor = vec3f( 1.0 );
		var sampleCount = 0u;

		// TODO: fix shadow acne? RTIOW says we could just ignore ray hits that are too close
		for (var bounce = 0u; bounce < bounces; bounce++) {
			let hitResult = bvhIntersectFirstHit( geom_index, geom_position, bvh, ray );

			// write result
			if ( hitResult.didHit ) {

				let material = materials[ geom_material_index[ hitResult.indices.x ] ];
				// var surfaceRecord: SurfaceRecord;
				// surfaceRecord.normal = hitResult.normal;
				// surfaceRecord.albedo = material.albedo;
				// surfaceRecord.roughness = material.roughness;
				// surfaceRecord.metalness = material.metalness;

				let hitPosition = getVertexAttribute( hitResult.barycoord, hitResult.indices.xyz, geom_position );
				let hitNormal = getVertexAttribute( hitResult.barycoord, hitResult.indices.xyz, geom_normals );

				let scatterRec = bsdfEval(hitNormal, - ray.direction);
				// let scatterRec = bsdfEval(hitResult.normal, - ray.direction);
				// TODO: fix shadow acne
				// if (bounce == 1) {
				// 	resultColor = vec3f( 0.0, 1.0, 0.0 ); //  dot( scatterRec.direction, hitNormal ) ); // ( vec3f( 1.0 ) + scatterRec.direction ) * 0.5;
				// 	sampleCount = 1;
				// 	break;
				// }

				throughputColor *= material.albedo * scatterRec.value / scatterRec.pdf;

				ray.origin = hitPosition;
				ray.direction = scatterRec.direction;

			} else {

				let background = ( vec3f( 0.5 ) );
				resultColor += background * throughputColor;
				sampleCount += 1;
				break;
			}

		}

		if ( sampleCount == 0 ) {
			return;
		}

		const accumulate: bool = true;

		let index = indexUV.x + indexUV.y * targetDimensions.x;

		let prevColor = textureLoad( outputTarget, indexUV );
		if ( accumulate ) {
			let prevSampleCount = textureLoad( sampleCountTarget, indexUV ).r;
			let newSampleCount = prevSampleCount + sampleCount;
			textureStore( sampleCountTarget, indexUV, vec4( newSampleCount ) );

			let newColor = ( ( prevColor.xyz * f32( prevSampleCount ) ) + resultColor ) / f32( newSampleCount );
			textureStore( outputTarget, indexUV, vec4f( newColor, 1.0 ) );
		} else {

			let color = vec4f( resultColor.xyz / f32( sampleCount ), 1.0 );
			textureStore( outputTarget, indexUV, color );

		}

	}
`, [ ndcToCameraRay, bvhIntersectFirstHit, constants, getVertexAttribute, materialStruct, surfaceRecordStruct, pcgRand3, pcgInit, lambertBsdfFunc ] );

export default megakernelShader;
