#pragma kernel Reduce_MC_1024

#define PI 3.1415927

Texture2D<float4> input_data;
RWBuffer<float4> coefficients_buffer;

struct CS_INPUT
{
	uint3 Gid : SV_GroupID;
	uint3 GTid : SV_GroupThreadID;
	uint3 DTid : SV_DispatchThreadID;
	uint GI : SV_GroupIndex;
};

groupshared float4 groupMem[1024];

[numthreads(32,32,1)]
void Reduce_MC_1024(CS_INPUT input)
{
	//read the input
	groupMem[input.GI] = input_data[input.DTid.xy];

	GroupMemoryBarrierWithGroupSync();

	if (input.GI < 512)
		groupMem[input.GI] += groupMem[input.GI + 512];

	GroupMemoryBarrierWithGroupSync();

	if (input.GI < 256)
		groupMem[input.GI] += groupMem[input.GI + 256];

	GroupMemoryBarrierWithGroupSync();

	if (input.GI < 128)
		groupMem[input.GI] += groupMem[input.GI + 128];

	GroupMemoryBarrierWithGroupSync();

	if (input.GI < 64)
		groupMem[input.GI] += groupMem[input.GI + 64];

	GroupMemoryBarrierWithGroupSync();

	if (input.GI < 32)
		groupMem[input.GI] += groupMem[input.GI + 32];

	GroupMemoryBarrierWithGroupSync();

	if (input.GI < 16)
		groupMem[input.GI] += groupMem[input.GI + 16];

	GroupMemoryBarrierWithGroupSync();

	if (input.GI < 8)
		groupMem[input.GI] += groupMem[input.GI + 8];

	GroupMemoryBarrierWithGroupSync();

	if (input.GI < 4)
		groupMem[input.GI] += groupMem[input.GI + 4];

	GroupMemoryBarrierWithGroupSync();

	if (input.GI < 2)
		groupMem[input.GI] += groupMem[input.GI + 2];

	GroupMemoryBarrierWithGroupSync();

	if (input.GI == 0)
	{
		uint flatten_group_id = input.Gid.y * 3 + input.Gid.x;
		coefficients_buffer[flatten_group_id] = (groupMem[0] + groupMem[1]) * 4 * PI * 0.0009765625; // 0.0009765625 = 1 / 1024
	}
}
