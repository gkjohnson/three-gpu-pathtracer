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

		if(
			( light.type == 0 && intersectsRectangle( light.position, normal, u, v, rayOrigin, rayDirection, dist ) ) ||
			( light.type == 1 && intersectsCircle( light.position, normal, u, v, rayOrigin, rayDirection, dist ) )
		) {

			if ( dist < lightSampleRec.dist || !lightSampleRec.hit ) {

				lightSampleRec.hit = true;
				lightSampleRec.dist = dist;
				float cosTheta = dot( rayDirection, normal );
				lightSampleRec.pdf = ( dist * dist ) / ( light.area * cosTheta );
				lightSampleRec.emission = light.color * light.intensity;
				lightSampleRec.direction = rayDirection;

			}

		}

	}

	return lightSampleRec;

}

LightSampleRec randomRectAreaLightSample( Light light, vec3 rayOrigin ) {

	LightSampleRec lightSampleRec;
	lightSampleRec.hit = true;

	lightSampleRec.emission = light.color * light.intensity;

	vec3 randomPos = light.position + light.u * ( rand() - 0.5 ) + light.v * ( rand() - 0.5 );
	vec3 toLight = randomPos - rayOrigin;
	float lightDistSq = dot( toLight, toLight );
	lightSampleRec.dist = sqrt( lightDistSq );

	vec3 direction = toLight / lightSampleRec.dist;
	lightSampleRec.direction = direction;

	vec3 lightNormal = normalize( cross( light.u, light.v ) );
	lightSampleRec.pdf = lightDistSq / ( light.area * dot( direction, lightNormal ) );

	return lightSampleRec;

}

LightSampleRec randomCircularAreaLightSample( Light light, vec3 rayOrigin ) {

	LightSampleRec lightSampleRec;
	lightSampleRec.hit = true;

	lightSampleRec.emission = light.color * light.intensity;

	float r = 2.0 * sqrt( rand() );
	float theta = rand() * 2.0 * PI;
	float x = r * cos( theta );
	float y = r * sin( theta );

	vec3 randomPos = light.position + light.u * x + light.v * y;
	vec3 toLight = randomPos - rayOrigin;
	float lightDistSq = dot( toLight, toLight );
	lightSampleRec.dist = sqrt( lightDistSq );

	vec3 direction = toLight / lightSampleRec.dist;
	lightSampleRec.direction = direction;

	vec3 lightNormal = normalize( cross( light.u, light.v ) );
	lightSampleRec.pdf = lightDistSq / ( light.area * dot( direction, lightNormal ) );

	return lightSampleRec;

}

LightSampleRec randomSpotLightSample( SpotLight spotLight, sampler2DArray iesProfiles, vec3 rayOrigin ) {

	LightSampleRec lightSampleRec;
	lightSampleRec.hit = true;

	float r = 2.0 * spotLight.radius * sqrt( rand() );
	float theta = rand() * 2.0 * PI;
	float x = r * cos( theta );
	float y = r * sin( theta );

	vec3 u = spotLight.u;
	vec3 v = spotLight.v;
	vec3 lightNormal = normalize( cross( u, v ) );

	float angle = acos( spotLight.coneCos );
	float angleTan = tan( angle );
	float startDistance = spotLight.radius / angleTan;

	vec3 randomPos = spotLight.position - lightNormal * startDistance + u * x + v * y;
	vec3 toLight = randomPos - rayOrigin;
	float lightDistSq = dot( toLight, toLight );
	lightSampleRec.dist = sqrt( lightDistSq );

	vec3 direction = toLight / max( lightSampleRec.dist, EPSILON );
	lightSampleRec.direction = direction;

	float cosTheta = dot( direction, lightNormal );

	float spotAttenuation = spotLight.iesProfile != -1 ?
		  getPhotometricAttenuation( iesProfiles, spotLight.iesProfile, direction, lightNormal, u, v )
		: getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, cosTheta );

	float distanceAttenuation = getDistanceAttenuation( lightSampleRec.dist, spotLight.distance, spotLight.decay );

	lightSampleRec.emission = spotLight.color * spotLight.intensity * max( distanceAttenuation * spotAttenuation, EPSILON );

	lightSampleRec.pdf = 1.0;

	return lightSampleRec;

}

LightSampleRec randomLightSample( sampler2D lights, uint lightCount, vec3 rayOrigin ) {

	// pick a random light
	uint l = uint( rand() * float( lightCount ) );
	Light light = readLightInfo( lights, l );

	// sample the light
	if( light.type == 0 ) {

		// rectangular area light
		return randomRectAreaLightSample( light, rayOrigin );

	} else if( light.type == 1 ) {

		// circual area light
		return randomCircularAreaLightSample( light, rayOrigin );

	}

}

LightSampleRec randomSpotLightSample( sampler2D spotLights, sampler2DArray iesProfiles, uint spotLightCount, vec3 rayOrigin ) {

	// pick a random light
	uint l = uint( rand() * float( spotLightCount ) );
	SpotLight spotLight = readSpotLightInfo( spotLights, l );

	return randomSpotLightSample( spotLight, iesProfiles, rayOrigin );

}

`;
