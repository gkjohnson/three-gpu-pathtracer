export const traceSceneGLSL = /* glsl */`

	#define NO_HIT 0
	#define SURFACE_HIT 1
	#define LIGHT_HIT 2
	#define FOG_HIT 3

	int traceScene(

		Ray ray, BVH bvh, LightsInfo lights, Material fogMaterial,
		out GeometryHit geoHit, out LightSampleRecord lightSampleRec

	) {

		bool hit = bvhIntersectFirstHit( bvh, ray.origin, ray.direction, geoHit.faceIndices, geoHit.faceNormal, geoHit.barycoord, geoHit.side, geoHit.dist );
		bool lightHit = lightsClosestHit( lights.tex, lights.count, ray.origin, ray.direction, lightSampleRec );

		#if FEATURE_FOG

		if ( fogMaterial.fogVolume ) {

			float particleDist = intersectFogVolume( fogMaterial, sobol( 1 ) );
			if ( particleDist + 1e-4 < geoHit.dist && ( particleDist + 1e-4 < lightSampleRec.dist || ! lightHit ) ) {

				geoHit.side = 1.0;
				geoHit.faceNormal = normalize( - ray.direction );
				geoHit.dist = particleDist;
				return FOG_HIT;

			}

		}

		#endif

		if ( lightHit && ( lightSampleRec.dist < geoHit.dist || ! hit ) ) {

			return LIGHT_HIT;

		}

		if ( hit ) {

			return SURFACE_HIT;

		}

		return NO_HIT;

	}

`;
