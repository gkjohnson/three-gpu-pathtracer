export const shaderVolumeMaterialFunctions = /* glsl */`

#ifndef FOG_CHECK_ITERATIONS
#define FOG_CHECK_ITERATIONS 20
#endif

bool isMaterialFogVolume( uint materialIndex, sampler2D materials ) {

	return false;

}

bool bvhIntersectVolumeHit(
	BVH bvh, vec3 rayOrigin, vec3 rayDirection,
	usampler2D materialIndexAttribute, sampler2D materials,
	out Material material
) {

	uniform usampler2D materialIndexAttribute;
	uniform sampler2D materials;

	for ( int i = 0; i < FOG_CHECK_ITERATIONS; i ++ ) {

		uvec4 faceIndices = uvec4( 0u );
		vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
		vec3 barycoord = vec3( 0.0 );
		float side = 1.0;
		float dist = 0.0;
		bool hit = bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist );
		if ( hit && side == - 1.0 ) {

			uint materialIndex = uTexelFetch1D( materialIndexAttribute, faceIndices.x ).r;
			if ( isMaterialFogVolume( materialIndex, materials ) ) {

				material = readMaterialInfo( materials, materialIndex );
				return true;

			}

		}

		rayOrigin = stepRayOrigin( rayOrigin, rayDirection, faceNormal, dist );

	}

	return false;

}

`;
