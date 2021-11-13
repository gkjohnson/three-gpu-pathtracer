export const shaderMaterialStructs = /* glsl */ `

    struct Material {

        vec3 color;
        int map;

        float metalness;
        int metalnessMap;

        float roughness;
        int roughnessMap;

        float ior;
        float transmission;
        int transmissionMap;

        vec3 emissive;
        float emissiveIntensity;
        int emissiveMap;

    	int normalMap;
		vec2 normalScale;

    };

`;

export const pathTracingHelpers = /* glsl */ `

	vec3 getHemisphereSample( vec3 normal, vec2 uv ) {

		uv = abs( uv );

		// https://www.rorydriscoll.com/2009/01/07/better-sampling/
		vec3 tangent;
		vec3 bitangent;

		if ( abs( normal.x ) > 0.9 ) {

			tangent = vec3( 0.0, 1.0, 0.0 );

		} else {

			tangent = vec3( 1.0, 0.0, 0.0 );

		}

		bitangent = cross( normal, tangent );
		tangent = cross( normal, bitangent );

		float r = sqrt( uv.x );
		float theta = 2.0 * PI * uv.y;
		float x = r * cos( theta );
		float y = r * sin( theta );
		return normalize( x * tangent + y * bitangent + sqrt( 1.0 - uv.x ) * normal );

	}

`;
