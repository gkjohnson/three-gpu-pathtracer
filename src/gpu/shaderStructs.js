export const shaderMaterialStructs = /* glsl */ `

    struct Material {

        vec3 color;
        sampler2D map;

        float metalness;
        sampler2D metalnessMap;

        float roughness;
        sampler2D roughnessMap;

        float ior;
        float transmission;
        sampler2D transmissionMap;

        vec3 emissive;
        float emissiveIntensity;
        sampler2D emissiveMap;

        sampler2D normalMap;

    };

`;
