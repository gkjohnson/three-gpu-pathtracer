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

// float atan2(float y, float x) {

//     bool s = ( abs( x ) > abs( y ) );
//     return mix( PI / 2.0 - atan( x, y ), atan( y, x ), s );

// }

float getPhotometricAttenuation(int iesProfile, vec3 posToLight, vec3 lightDir, vec3 u, vec3 v) {
    float cosTheta = dot(-posToLight, lightDir);
    float angle = acos(cosTheta) * (1.0 / PI);

	//float y = dot( posToLight, u ); // TODO: use azimuth if any IES profiles require this
	//float x = dot( posToLight, v );
	//float a2 = atan2( y, x );

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

		if( light.type == 0 ) {

			if ( intersectsRectangle( light.position, normal, u, v, rayOrigin, rayDirection, dist ) ) {

				if ( dist < lightSampleRec.dist || !lightSampleRec.hit ) {

					lightSampleRec.hit = true;
					lightSampleRec.dist = dist;
					float cosTheta = dot( rayDirection, normal );
					lightSampleRec.pdf = ( dist * dist ) / ( light.area * cosTheta );
					lightSampleRec.emission = light.color * light.intensity;
					lightSampleRec.direction = rayDirection;

				}

			}

		} else {

			SpotLight spotLight = readSpotLightInfo( lights, l );

			float angle = acos( spotLight.coneCos );
			float angleTan = tan( angle );
			float startDistance = spotLight.radius / angleTan;

			vec3 lightPosition = light.position - normal * startDistance;
			if ( spotLight.lampIntensityScale > 0.0 && spotLight.radius > 0.0 && intersectsCircle( lightPosition, normal, u, v, spotLight.radius * 2.0, rayOrigin, rayDirection, dist ) ) {

				if ( dist < lightSampleRec.dist || !lightSampleRec.hit ) {

					lightSampleRec.hit = true;
					lightSampleRec.dist = dist;
					float cosTheta = dot( rayDirection, normal );
					lightSampleRec.pdf = ( dist * dist ) / ( light.area * cosTheta );
					lightSampleRec.emission = light.color * light.intensity * spotLight.lampIntensityScale;
					lightSampleRec.direction = rayDirection;

				}

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

LightSampleRec randomSpotLightSample( Light light, SpotLight spotLight, vec3 rayOrigin ) {

	LightSampleRec lightSampleRec;
	lightSampleRec.hit = true;

	float r = 2.0 * spotLight.radius * sqrt( rand() );
	float theta = rand() * 2.0 * PI;
	float x = r * cos( theta );
	float y = r * sin( theta );

	vec3 u = light.u;
	vec3 v = light.v;
	vec3 lightNormal = normalize( cross( u, v ) );

	float angle = acos( spotLight.coneCos );
	float angleTan = tan( angle );
	float startDistance = spotLight.radius / angleTan;

	vec3 randomPos = light.position - lightNormal * startDistance + u * x + v * y;
	vec3 toLight = randomPos - rayOrigin;
	float lightDistSq = dot( toLight, toLight );
	lightSampleRec.dist = sqrt( lightDistSq );

	vec3 direction = toLight / max( lightSampleRec.dist, EPSILON );
	lightSampleRec.direction = direction;

	float cosTheta = dot( direction, lightNormal );

	float spotAttenuation = spotLight.iesProfile != -1 ?
		  getPhotometricAttenuation( spotLight.iesProfile, direction, -lightNormal, u, v )
		: getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, cosTheta );

	float distanceAttenuation = getDistanceAttenuation( lightSampleRec.dist, spotLight.distance, spotLight.decay );

	lightSampleRec.emission = light.color * light.intensity;

	lightSampleRec.pdf = 1.0 / max( distanceAttenuation * spotAttenuation, EPSILON );

	return lightSampleRec;

}

LightSampleRec randomLightSample( sampler2D lights, uint lightCount, vec3 rayOrigin ) {

	// pick a random light
	uint l = uint( rand() * float( lightCount ) );
	Light light = readLightInfo( lights, l );

	// sample the light
	if( light.type == 0 )

		// rectangular area light
		return randomRectAreaLightSample( light, rayOrigin );

	else {

		// spot light
		SpotLight spotLight = readSpotLightInfo( lights, l );
		return randomSpotLightSample( light, spotLight, rayOrigin );

	}

}

`;
