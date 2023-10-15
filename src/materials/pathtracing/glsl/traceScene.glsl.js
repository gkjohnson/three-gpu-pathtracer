export const traceSceneGLSL = /* glsl */`

	#define NO_HIT 0
	#define SURFACE_HIT 1
	#define LIGHT_HIT 2
	#define FOG_HIT 3

	// Passing the global variable 'lights' into this function caused shader program errors.
	// So global variables like 'lights' and 'bvh' were moved out of the function parameters.
	// For more information, refer to: https://github.com/gkjohnson/three-gpu-pathtracer/pull/457
	int traceScene(

		Ray ray, Material fogMaterial,
		out SurfaceHit surfaceHit, out LightRecord lightRec

	) {

		bool hit = bvhIntersectFirstHit( bvh, ray.origin, ray.direction, surfaceHit.faceIndices, surfaceHit.faceNormal, surfaceHit.barycoord, surfaceHit.side, surfaceHit.dist );
		bool lightHit = lightsClosestHit( lights.tex, lights.count, ray.origin, ray.direction, lightRec );

		#if FEATURE_FOG

		if ( fogMaterial.fogVolume ) {

			float particleDist = intersectFogVolume( fogMaterial, sobol( 1 ) );
			if ( particleDist + 1e-4 < surfaceHit.dist && ( particleDist + 1e-4 < lightRec.dist || ! lightHit ) ) {

				surfaceHit.side = 1.0;
				surfaceHit.faceNormal = normalize( - ray.direction );
				surfaceHit.dist = particleDist;
				return FOG_HIT;

			}

		}

		#endif

		if ( lightHit && ( lightRec.dist < surfaceHit.dist || ! hit ) ) {

			return LIGHT_HIT;

		}

		if ( hit ) {

			return SURFACE_HIT;

		}

		return NO_HIT;

	}

`;
