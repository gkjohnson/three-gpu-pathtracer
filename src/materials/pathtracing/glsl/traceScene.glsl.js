export const traceSceneGLSL = /* glsl */`

	#define NO_HIT 0
	#define SURFACE_HIT 1
	#define LIGHT_HIT 2
	#define FOG_HIT 3

	int traceScene(

		vec3 rayOrigin, vec3 rayDirection,
		BVH bvh, LightsInfo lights, Material fogMaterial,
		out uvec4 faceIndices, out vec3 faceNormal, out vec3 barycoord, out float side, out float dist,
		out LightSampleRecord lightSampleRec

	) {

		bool hit = bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist );
		bool lightHit = lightsClosestHit( lights.tex, lights.count, rayOrigin, rayDirection, lightSampleRec );

		#if FEATURE_FOG

		if ( fogMaterial.fogVolume ) {

			float particleDist = intersectFogVolume( fogMaterial, sobol( 1 ) );
			if ( particleDist + 1e-4 < dist && ( particleDist + 1e-4 < lightSampleRec.dist || ! lightHit ) ) {

				side = 1.0;
				faceNormal = normalize( - rayDirection );
				dist = particleDist;
				return FOG_HIT;

			}

		}

		#endif

		if ( lightHit && ( lightSampleRec.dist < dist || ! hit ) ) {

			return LIGHT_HIT;

		}

		if ( hit ) {

			return SURFACE_HIT;

		}

		return NO_HIT;

	}

`;
