terraform {
  required_version = ">= 1.7"

  required_providers {
    datadog = {
      source  = "DataDog/datadog"
      version = "~> 4.0"
    }
  }
}
