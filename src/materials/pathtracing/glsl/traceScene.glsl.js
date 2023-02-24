export const traceSceneGLSL = /* glsl */`

	#define NO_HIT 0
	#define SURFACE_HIT 1
	#define LIGHT_HIT 2
	int traceScene(

		vec3 rayOrigin, vec3 rayDirection,
		BVH bvh, LightsInfo lights,
		out uvec4 faceIndices, out vec3 faceNormal, out vec3 barycoord, out float side, out float dist,
		out LightSampleRecord lightSampleRec

	) {

		bool hit = bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist );
		bool lightHit = lightsClosestHit( lights.tex, lights.count, rayOrigin, rayDirection, lightSampleRec );
		if ( lightHit && ( lightSampleRec.dist < dist || ! hit ) ) {

			return LIGHT_HIT;

		}

		if ( hit ) {

			return SURFACE_HIT;

		}

		return NO_HIT;

	}

`;
