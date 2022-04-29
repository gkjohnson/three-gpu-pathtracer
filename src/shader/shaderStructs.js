export const shaderMaterialStructs = /* glsl */ `

	struct PhysicalCamera {

		float focusDistance;
		float anamorphicRatio;
		float bokehSize;
		int apertureBlades;
		float apertureRotation;

	};

	struct EquirectHdrInfo {

		sampler2D marginalWeights;
		sampler2D conditionalWeights;
		sampler2D map;

	};

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

		float emissiveIntensity;
		vec3 emissive;
		int emissiveMap;

		int normalMap;
		vec2 normalScale;

		float opacity;
		float alphaTest;

		float side;
		bool matte;

	};

	Material readMaterialInfo( sampler2D tex, uint index ) {

		uint i = index * 6u;

		vec4 s0 = texelFetch1D( tex, i + 0u );
		vec4 s1 = texelFetch1D( tex, i + 1u );
		vec4 s2 = texelFetch1D( tex, i + 2u );
		vec4 s3 = texelFetch1D( tex, i + 3u );
		vec4 s4 = texelFetch1D( tex, i + 4u );
		vec4 s5 = texelFetch1D( tex, i + 5u );

		Material m;
		m.color = s0.rgb;
		m.map = floatBitsToInt( s0.a );

		m.metalness = s1.r;
		m.metalnessMap = floatBitsToInt( s1.g );
		m.roughness = s1.b;
		m.roughnessMap = floatBitsToInt( s1.a );

		m.ior = s2.r;
		m.transmission = s2.g;
		m.transmissionMap = floatBitsToInt( s2.b );
		m.emissiveIntensity = s2.a;

		m.emissive = s3.rgb;
		m.emissiveMap = floatBitsToInt( s3.a );

		m.normalMap = floatBitsToInt( s4.r );
		m.normalScale = s4.gb;

		m.opacity = s5.r;
		m.alphaTest = s5.g;
		m.side = s5.b;
		m.matte = bool( s5.a );

		return m;



	}

`;
