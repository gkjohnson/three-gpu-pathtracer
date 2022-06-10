export const shaderLightSampling = /* glsl */`

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
	for ( l = 0u; l < lightCount; l++ ) {

		Light light = readLightInfo( lights, l );

		vec3 u = light.u;
		vec3 v = light.v;

		// check for backface
		vec3 normal = normalize( cross( u, v ) );
		if ( dot( normal, rayDirection ) < 0.0 ) {
			continue;
		}

		u *= 1.0 / dot(u, u);
		v *= 1.0 / dot(v, v);

		float dist;
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
	lightSampleRec.dist = length( toLight );

	vec3 direction = normalize( toLight );
	lightSampleRec.direction = direction;

	vec3 lightNormal = normalize( cross( light.u, light.v ) );
	lightSampleRec.pdf = lightDistSq / ( light.area * dot( direction, lightNormal ) );

	return lightSampleRec;

}

LightSampleRec randomLightSample( sampler2D lights, uint lightCount, vec3 rayOrigin ) {

	// pick a random light
	uint l = uint( rand() * float( lightCount ) );
	Light light = readLightInfo( lights, l );

	// sample the light
	return randomRectAreaLightSample( light, rayOrigin );

}

`;
