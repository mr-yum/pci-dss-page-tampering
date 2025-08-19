
v1alpha1.extension_repo(name="mr-yum-tilt-extensions", url="https://github.com/mr-yum/tilt-extensions")
v1alpha1.extension(name="mr-yum", repo_name="mr-yum-tilt-extensions")
load("ext://mr-yum", "mryum_v1")

mryum_v1.local_node_resource("pci-dss-page-tampering-install",
  cmd="npm ci",
  allow_parallel=True,
  labels=["pci-dss-page-tampering"],
  deps=["package.json", "package-lock.json"]
)

mryum_v1.local_node_resource("pci-dss-page-tampering-secrets",
  cmd="npm run secrets:pull --if-present",
  deps=[".meandu.yml"],
  resource_deps=[
    "pci-dss-page-tampering-install",
  ],
  allow_parallel=True,
  labels=["pci-dss-page-tampering"]
)

mryum_v1.local_node_resource("pci-dss-page-tampering-compile",
  serve_cmd="npm run develop",
  resource_deps=[
    "pci-dss-page-tampering-install",
  ],
  labels=["pci-dss-page-tampering"]
)
