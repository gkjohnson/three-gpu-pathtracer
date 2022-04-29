export const shaderMaterialStructs = /* glsl */ `

	struct PhysicalCamera {

		float focusDistance;
		float anamorphicRatio;
		float bokehSize;
		int apertureBlades;
		float apertureRotation;

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

		vec3 emissive;
		float emissiveIntensity;
		int emissiveMap;

		int normalMap;
		vec2 normalScale;

		float opacity;
		float alphaTest;

		float side;

		bool matte;

	};

`;
