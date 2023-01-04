export const shaderLightSampling = /* glsl */`

float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {

	return smoothstep( coneCosine, penumbraCosine, angleCosine );

}

float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {

	// based upon Frostbite 3 Moving to Physically-based Rendering
	// page 32, equation 26: E[window1]
	// https://seblagarde.files.wordpress.com/2015/07/course_notes_moving_frostbite_to_pbr_v32.pdf
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), EPSILON );

	if ( cutoffDistance > 0.0 ) {

		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );

	}

	return distanceFalloff;

}

float getPhotometricAttenuation( sampler2DArray iesProfiles, int iesProfile, vec3 posToLight, vec3 lightDir, vec3 u, vec3 v ) {

    float cosTheta = dot( posToLight, lightDir );
    float angle = acos( cosTheta ) * ( 1.0 / PI );

    return texture2D( iesProfiles, vec3( 0.0, angle, iesProfile ) ).r;

}

struct LightSampleRec {

	bool hit;
	float dist;
	vec3 direction;
	float pdf;
	vec3 emission;
	int type;

};

LightSampleRec lightsClosestHit( sampler2D lights, uint lightCount, vec3 rayOrigin, vec3 rayDirection ) {

	LightSampleRec lightSampleRec;
	lightSampleRec.hit = false;

	uint l;
	for ( l = 0u; l < lightCount; l ++ ) {

		Light light = readLightInfo( lights, l );

		vec3 u = light.u;
		vec3 v = light.v;

		// check for backface
		vec3 normal = normalize( cross( u, v ) );
		if ( dot( normal, rayDirection ) < 0.0 ) {
			continue;
		}

		u *= 1.0 / dot( u, u );
		v *= 1.0 / dot( v, v );

		float dist;

		// MIS / light intersection is not supported for punctual lights.
		if(
			( light.type == RECT_AREA_LIGHT_TYPE && intersectsRectangle( light.position, normal, u, v, rayOrigin, rayDirection, dist ) ) ||
			( light.type == CIRC_AREA_LIGHT_TYPE && intersectsCircle( light.position, normal, u, v, rayOrigin, rayDirection, dist ) )
		) {

			if ( dist < lightSampleRec.dist || ! lightSampleRec.hit ) {

				float cosTheta = dot( rayDirection, normal );

				lightSampleRec.hit = true;
				lightSampleRec.dist = dist;
				lightSampleRec.pdf = ( dist * dist ) / ( light.area * cosTheta );
				lightSampleRec.emission = light.color * light.intensity;
				lightSampleRec.direction = rayDirection;
				lightSampleRec.type = light.type;

			}

		}

	}

	return lightSampleRec;

}

LightSampleRec randomAreaLightSample( Light light, vec3 rayOrigin, vec2 ruv ) {

	LightSampleRec lightSampleRec;
	lightSampleRec.hit = true;
	lightSampleRec.type = light.type;

	lightSampleRec.emission = light.color * light.intensity;

	vec3 randomPos;
	if( light.type == RECT_AREA_LIGHT_TYPE ) {

		// rectangular area light
		randomPos = light.position + light.u * ( ruv.x - 0.5 ) + light.v * ( ruv.y - 0.5 );

	} else if( light.type == CIRC_AREA_LIGHT_TYPE ) {

		// circular area light
		float r = 0.5 * sqrt( ruv.x );
		float theta = ruv.y * 2.0 * PI;
		float x = r * cos( theta );
		float y = r * sin( theta );

		randomPos = light.position + light.u * x + light.v * y;

	}

	vec3 toLight = randomPos - rayOrigin;
	float lightDistSq = dot( toLight, toLight );
	lightSampleRec.dist = sqrt( lightDistSq );

	vec3 direction = toLight / lightSampleRec.dist;
	lightSampleRec.direction = direction;

	vec3 lightNormal = normalize( cross( light.u, light.v ) );
	lightSampleRec.pdf = lightDistSq / ( light.area * dot( direction, lightNormal ) );

	return lightSampleRec;

}

LightSampleRec randomSpotLightSample( Light light, sampler2DArray iesProfiles, vec3 rayOrigin, vec2 ruv ) {

	float radius = light.radius * sqrt( ruv.x );
	float theta = ruv.y * 2.0 * PI;
	float x = radius * cos( theta );
	float y = radius * sin( theta );

	vec3 u = light.u;
	vec3 v = light.v;
	vec3 normal = normalize( cross( u, v ) );

	float angle = acos( light.coneCos );
	float angleTan = tan( angle );
	float startDistance = light.radius / max( angleTan, EPSILON );

	vec3 randomPos = light.position - normal * startDistance + u * x + v * y;
	vec3 toLight = randomPos - rayOrigin;
	float lightDistSq = dot( toLight, toLight );
	float dist = sqrt( lightDistSq );

	vec3 direction = toLight / max( dist, EPSILON );
	float cosTheta = dot( direction, normal );

	float spotAttenuation = light.iesProfile != - 1 ?
		getPhotometricAttenuation( iesProfiles, light.iesProfile, direction, normal, u, v ) :
		getSpotAttenuation( light.coneCos, light.penumbraCos, cosTheta );

	float distanceAttenuation = getDistanceAttenuation( dist, light.distance, light.decay );
	LightSampleRec lightSampleRec;
	lightSampleRec.hit = true;
	lightSampleRec.type = light.type;
	lightSampleRec.dist = dist;
	lightSampleRec.direction = direction;
	lightSampleRec.emission = light.color * light.intensity * distanceAttenuation * spotAttenuation;
	lightSampleRec.pdf = 1.0;

	return lightSampleRec;

}

LightSampleRec randomLightSample( sampler2D lights, sampler2DArray iesProfiles, uint lightCount, vec3 rayOrigin, vec3 ruv ) {

	// pick a random light
	uint l = uint( ruv.x * float( lightCount ) );
	Light light = readLightInfo( lights, l );

	if ( light.type == SPOT_LIGHT_TYPE ) {

		return randomSpotLightSample( light, iesProfiles, rayOrigin, ruv.yz );

	} else if ( light.type == POINT_LIGHT_TYPE ) {

		vec3 lightRay = light.u - rayOrigin;
		float lightDist = length( lightRay );
		float cutoffDistance = light.distance;
		float distanceFalloff = 1.0 / max( pow( lightDist, light.decay ), 0.01 );
		if ( cutoffDistance > 0.0 ) {

			distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDist / cutoffDistance ) ) );

		}

		LightSampleRec rec;
		rec.hit = true;
		rec.direction = normalize( lightRay );
		rec.dist = length( lightRay );
		rec.pdf = 1.0;
		rec.emission = light.color * light.intensity * distanceFalloff;
		rec.type = light.type;
		return rec;

	} else if ( light.type == DIR_LIGHT_TYPE ) {

		LightSampleRec rec;
		rec.hit = true;
		rec.dist = 1e10;
		rec.direction = light.u;
		rec.pdf = 1.0;
		rec.emission = light.color * light.intensity;
		rec.type = light.type;

		return rec;

	} else {

		// sample the light
		return randomAreaLightSample( light, rayOrigin, ruv.yz );

	}

}

`;
